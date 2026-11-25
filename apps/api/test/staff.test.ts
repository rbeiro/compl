import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { json, postJson, setupApp } from "./fixtures.js";

const { app, pool, mailer, createUser, addStaff, tokenFor, close } = await setupApp();
const H = "hotel-equipo";
let chef: string, cook: string, cookId: string;

const call = (token: string, method: string, path: string, body?: unknown) =>
  app.request(`/v1/hotels/${H}/staff${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
const list = async () => (await json(call(chef, "GET", ""))).items as Array<Record<string, any>>;
const register = (requestId: string, givenName = "Núria", surname = "Martí Ruiz") =>
  call(chef, "POST", "", { requestId, givenName, surname, position: "Cocinera", outlet: "Enoteca", rank: 3 });

beforeAll(async () => {
  await pool.query("insert into compi_private.hotel_codes (hotel_key, code) values ($1, 'eq')", [H]);
  const [c, k] = await Promise.all([createUser("jefa@compichef.com"), createUser("cocinero.eq@compichef.com")]);
  await addStaff(c!, H, 1);
  cookId = await addStaff(k!, H, 3);
  chef = await tokenFor(c!, { aal: "aal2" });
  cook = await tokenFor(k!);
});
afterAll(close);

describe("team management", () => {
  it("is only for the executive chef", async () => {
    expect((await call(cook, "GET", "")).status).toBe(403);
    const attempt = { requestId: randomUUID(), givenName: "A", surname: "B", position: "C", outlet: "D", rank: 3 };
    expect((await call(cook, "POST", "", attempt)).status).toBe(403);
    const items = await list();
    expect(items.map((m) => m.email)).toEqual(expect.arrayContaining(["jefa@compichef.com", "cocinero.eq@compichef.com"]));
  });

  it("registers an employee with a generated address and a one-time password", async () => {
    const requestId = randomUUID();
    const res = await register(requestId, "Eustaquio", "García");
    expect(res.status).toBe(201);
    const account = await res.json() as { email: string; password: string; mustChange: boolean };
    expect(account.email).toBe("e.garcia.eq@compichef.com");
    expect(account.password).toMatch(/^[A-Za-z2-9]{16}$/);
    expect(account.mustChange).toBe(true);
    // A retry never creates a second login nor shows the password again.
    const retry = await register(requestId, "Eustaquio", "García");
    expect(retry.status).toBe(409);
    expect((await retry.json() as any).error.code).toBe("already_created");
    // The new employee signs in and must choose a password.
    const session = await json(app.request("/v1/auth/sign-in", postJson({ email: account.email, password: account.password })));
    expect(session.next).toBe("password_change");
    const member = (await list()).find((m) => m.email === account.email)!;
    expect(member).toMatchObject({ hasAccount: true, rank: 3, inviteState: "accepted", name: "Eustaquio García" });
    // The same initial and surname get another letter.
    const second = await json(register(randomUUID(), "Esteban", "García"));
    expect(second.email).toBe("es.garcia.eq@compichef.com");
  });

  it("changes ranks with the previous value and keeps an administrator", async () => {
    expect((await call(chef, "PUT", `/${cookId}/rank`, { rank: 2, previous: 1 })).status).toBe(409);
    expect((await call(chef, "PUT", `/${cookId}/rank`, { rank: 2, previous: 3 })).status).toBe(204);
    expect((await list()).find((m) => m.id === cookId)!.rank).toBe(2);
    const me = (await list()).find((m) => m.email === "jefa@compichef.com")!;
    const res = await call(chef, "PUT", `/${me.id}/rank`, { rank: 2, previous: 1 });
    expect(res.status).toBe(409);
    expect((await res.json() as any).error.detail).toBe("Debe quedar un administrador activo en el hotel");
  });

  it("withdraws and restores access, then deletes a withdrawn employee", async () => {
    expect((await call(chef, "PUT", `/${cookId}/access`, { enabled: false, expectedRank: 2 })).status).toBe(204);
    let member = (await list()).find((m) => m.id === cookId)!;
    expect(member.withdrawnAt).toMatch(/Z$/);
    expect((await app.request(`/v1/me`, { headers: { Authorization: `Bearer ${cook}` } })).status).toBe(200);
    expect((await call(chef, "PUT", `/${cookId}/access`, { enabled: true, expectedRank: 2 })).status).toBe(204);
    expect((await list()).find((m) => m.id === cookId)!.withdrawnAt).toBeNull();
    expect((await call(chef, "PUT", `/${cookId}/access`, { enabled: false, expectedRank: 2 })).status).toBe(204);
    member = (await list()).find((m) => m.id === cookId)!;
    expect((await call(chef, "DELETE", `/${cookId}?withdrawnAt=${encodeURIComponent("2020-01-01T00:00:00.000000Z")}`)).status).toBe(409);
    expect((await call(chef, "DELETE", `/${cookId}?withdrawnAt=${encodeURIComponent(member.withdrawnAt)}`)).status).toBe(204);
    expect((await list()).some((m) => m.id === cookId)).toBe(false);
    const { rowCount } = await pool.query("select 1 from auth.users where email = 'cocinero.eq@compichef.com'");
    expect(rowCount).toBe(0);
  });

  it("emails an invitation to a pending employee, which they can accept", async () => {
    const { rows } = await pool.query<{ id: string }>(
      `insert into public.compi_staff (hotel_key, email, employee_name, position_name, outlet_name, access_rank, invite_state)
       values ($1, 'pendiente.eq@compichef.com', 'Persona Pendiente', 'Ayudante', 'Enoteca', 3, 'prepared') returning id`,
      [H],
    );
    const id = rows[0]!.id;
    const pending = (await list()).find((m) => m.id === id)!;
    expect(pending).toMatchObject({ hasAccount: false, inviteState: "prepared" });

    const sent = await call(chef, "POST", `/${id}/invitation`, { op: "send", previous: pending.inviteRevision, locale: "en" });
    expect(await json(sent)).toEqual({ state: "delivered" });
    const email = mailer.last("pendiente.eq@compichef.com")!;
    const link = /http:\/\/app\.test\/en\/invitacion#(v7_[0-9a-f]+)/.exec(email.text);
    expect(link).not.toBeNull();
    expect((await list()).find((m) => m.id === id)!.inviteState).toBe("delivered");

    // Cancel and resend with a fresh revision.
    const current = (await list()).find((m) => m.id === id)!;
    expect(await json(call(chef, "POST", `/${id}/invitation`, { op: "cancel", previous: current.inviteRevision }))).toEqual({ state: "cancelled" });
    const cancelled = (await list()).find((m) => m.id === id)!;
    expect((await call(chef, "POST", `/${id}/invitation`, { op: "replace", previous: randomUUID() })).status).toBe(409);
    expect(await json(call(chef, "POST", `/${id}/invitation`, { op: "replace", previous: cancelled.inviteRevision }))).toEqual({ state: "delivered" });
    const ticket = /#(v7_[0-9a-f]+)/.exec(mailer.last("pendiente.eq@compichef.com")!.text)![1];

    const accepted = await app.request("/v1/auth/invitations/accept", postJson({ ticket, password: "una-clave-segura" }));
    expect(await json(accepted)).toEqual({ email: "pendiente.eq@compichef.com" });
  });

  it("removes a registration that never got an account", async () => {
    const { rows } = await pool.query<{ id: string }>(
      `insert into public.compi_staff (hotel_key, email, employee_name, position_name, outlet_name, access_rank, invite_state)
       values ($1, 'borrar.eq@compichef.com', 'Para Borrar', 'Ayudante', 'Enoteca', 3, 'prepared') returning id`,
      [H],
    );
    expect((await call(chef, "DELETE", `/${rows[0]!.id}`)).status).toBe(204);
    expect((await list()).some((m) => m.id === rows[0]!.id)).toBe(false);
  });
});
