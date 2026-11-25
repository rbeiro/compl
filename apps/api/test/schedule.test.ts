import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { json, setupApp } from "./fixtures.js";

const { app, pool, createUser, addStaff, tokenFor, close } = await setupApp();
const H = "hotel-horarios";
let chef: string, cook: string, cookId: string, chefToken: string, otherDeptToken: string;

const call = (token: string, method: string, path: string, body?: unknown) =>
  app.request(`/v1/hotels/${H}/schedule${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

beforeAll(async () => {
  const [c, k, o] = await Promise.all([
    createUser("jefe@compichef.com"),
    createUser("cocina@compichef.com"),
    createUser("bar@compichef.com"),
  ]);
  await addStaff(c!, H, 1);
  cookId = await addStaff(k!, H, 3);
  await addStaff(o!, H, 3);
  // addStaff puts everyone in "Cocina"; move one person to another department.
  await pool.query("update public.compi_staff set outlet_name = 'Bar' where email = 'bar@compichef.com'");
  chefToken = await tokenFor(c!, { aal: "aal2" });
  [cook, otherDeptToken] = await Promise.all([tokenFor(k!), tokenFor(o!)]);
  chef = chefToken;
});
afterAll(close);

describe("schedules", () => {
  it("shows the user's own department by default", async () => {
    const res = await call(cook, "GET", "?month=2026-12");
    expect(res.status).toBe(200);
    const view: any = await res.json();
    expect(view).toMatchObject({ me: cookId, admin: false, dept: "cocina", shifts: [], requests: [] });
    expect(view.people.map((p: { department: string }) => p.department)).toEqual(expect.arrayContaining(["Cocina"]));
    expect(view.balances).toHaveLength(1); // staff only see their own balance
  });

  it("refuses other departments to staff, and invalid months", async () => {
    expect((await call(otherDeptToken, "GET", "?month=2026-12&department=Cocina")).status).toBe(403);
    expect((await call(cook, "GET", "?month=2026-13")).status).toBe(422);
  });

  it("lets the executive chef edit shifts with revisions", async () => {
    const day = "2026-12-02";
    expect((await call(cook, "PUT", `/shifts/${cookId}/${day}`, { kind: "off" })).status).toBe(403);
    expect((await call(chef, "PUT", `/shifts/${cookId}/${day}`, { kind: "work", start: "08:00", end: "08:00" })).status).toBe(422);
    expect((await call(chef, "PUT", `/shifts/${cookId}/${day}`, { kind: "work", start: "08:00", end: "16:00" })).status).toBe(204);
    const view = await json(call(chef, "GET", "?month=2026-12&department=Cocina"));
    const shift = view.shifts.find((s: { day: string }) => s.day === day);
    expect(shift).toMatchObject({ employee: cookId, kind: "work", starts: "08:00:00", ends: "16:00:00" });
    // A stale revision conflicts; the current one is accepted.
    expect((await call(chef, "PUT", `/shifts/${cookId}/${day}`, { kind: "off", previous: randomUUID() })).status).toBe(409);
    expect((await call(chef, "PUT", `/shifts/${cookId}/${day}`, { kind: "off", previous: shift.revision })).status).toBe(204);
    expect((await call(chef, "PUT", `/shifts/${cookId}/${day}`, { kind: "clear", previous: null })).status).toBe(409);
  });

  it("sets hours balances", async () => {
    expect((await call(chef, "PUT", `/balances/${cookId}/2026-11`, { minutes: 90 })).status).toBe(204);
    expect((await call(chef, "PUT", `/balances/${cookId}/2026-12`, { minutes: -30 })).status).toBe(204);
    const mine = (await json(call(cook, "GET", "?month=2026-12"))).balances[0];
    expect(mine).toMatchObject({ id: cookId, total: 60, adjustment: -30 });
  });

  it("requests leave, then the chef decides", async () => {
    const id = randomUUID();
    const days = ["2026-12-24", "2026-12-23"];
    expect((await call(cook, "PUT", `/leave/${id}`, { days })).status).toBe(204);
    expect((await call(cook, "PUT", `/leave/${id}`, { days })).status).toBe(204); // retry is harmless
    expect((await call(cook, "PUT", `/leave/${randomUUID()}`, { days: ["2026-12-24"] })).status).toBe(409);

    const mine = (await json(call(cook, "GET", "?month=2026-12"))).mine;
    expect(mine).toEqual([{ id, days: ["2026-12-23", "2026-12-24"], state: "pending" }]);

    expect((await call(cook, "PUT", `/leave/${id}/decision`, { decision: "approved" })).status).toBe(403);
    const requests = (await json(call(chef, "GET", "?month=2026-12&department=Cocina"))).requests;
    expect(requests[0]).toMatchObject({ id, state: "pending" });
    expect((await call(chef, "PUT", `/leave/${id}/decision`, { decision: "approved" })).status).toBe(204);
    expect((await call(chef, "PUT", `/leave/${id}/decision`, { decision: "rejected" })).status).toBe(409);

    const view = await json(call(chef, "GET", "?month=2026-12&department=Cocina"));
    expect(view.vacations).toEqual(expect.arrayContaining([{ employee: cookId, day: "2026-12-23" }]));
    // Approved leave blocks shifts on those days.
    expect((await call(chef, "PUT", `/shifts/${cookId}/2026-12-23`, { kind: "work", start: "08:00", end: "16:00" })).status).toBe(409);
  });

  it("limits leave to 45 days a year", async () => {
    const start = Date.UTC(2027, 0, 1);
    const days = Array.from({ length: 46 }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10));
    const res = await call(cook, "PUT", `/leave/${randomUUID()}`, { days });
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error.detail).toMatch(/45/);
  });
});
