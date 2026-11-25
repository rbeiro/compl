import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, json, setupApp } from "./fixtures.js";

const { app, createUser, addStaff, tokenFor, close } = await setupApp();
const H = "hotel-mail";
let ana: string, bea: string, out: string;

const call = (token: string, method: string, path: string, body?: unknown) =>
  app.request(`/v1/hotels/${H}/mail${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

beforeAll(async () => {
  const [a, b, o] = await Promise.all([
    createUser("ana@compichef.com"),
    createUser("bea@compichef.com"),
    createUser("fuera@compichef.com"),
  ]);
  await addStaff(a!, H, 3);
  await addStaff(b!, H, 2);
  await addStaff(o!, "hotel-otro-mail", 3);
  [ana, bea, out] = await Promise.all([tokenFor(a!), tokenFor(b!), tokenFor(o!)]);
});
afterAll(close);

describe("mail", () => {
  it("opens an empty mailbox with the user's address", async () => {
    const res = await call(ana, "GET", "");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ address: "ana@compichef.com", folders: [], entries: [], item: null });
  });

  it("refuses staff of another hotel and anonymous calls", async () => {
    expect((await call(out, "GET", "")).status).toBe(403);
    expect((await app.request(`/v1/hotels/${H}/mail`)).status).toBe(401);
  });

  it("saves a draft, detects stale revisions, sends and delivers", async () => {
    const id = randomUUID();
    const draft = { to: "bea@compichef.com", subject: "Turno", body: "Hola", revision: 0 };
    const saved = await json(call(ana, "PUT", `/messages/${id}`, draft));
    expect(saved).toEqual({ id, revision: 1, sent: false });
    const stale = await call(ana, "PUT", `/messages/${id}`, { ...draft, body: "Otra cosa", revision: 0 });
    expect(stale.status).toBe(409);

    const drafts = await json(call(ana, "GET", `?box=drafts&item=${id}`));
    expect(drafts.entries).toHaveLength(1);
    expect(drafts.item).toMatchObject({ id, body: "Hola", revision: 1, origin: "drafts" });

    const sent = await json(call(ana, "PUT", `/messages/${id}`, { ...draft, revision: 1, send: true }));
    expect(sent).toMatchObject({ id, sent: true });

    const inbox = await json(call(bea, "GET", ""));
    expect(inbox.entries).toHaveLength(1);
    expect(inbox.entries[0]).toMatchObject({ sender: "ana@compichef.com", subject: "Turno", unread: true, snippet: "Hola" });
  });

  it("rejects recipients outside the hotel", async () => {
    const res = await call(ana, "PUT", `/messages/${randomUUID()}`, {
      to: "fuera@compichef.com", subject: "x", body: "y", revision: 0, send: true,
    });
    expect(res.status).toBe(422);
  });

  it("stars, reads and moves messages between folders", async () => {
    const [entry] = (await json(call(bea, "GET", ""))).entries;
    expect((await call(bea, "POST", `/messages/${entry.id}/actions`, { action: "read" })).status).toBe(204);
    expect((await call(bea, "POST", `/messages/${entry.id}/actions`, { action: "star", value: true })).status).toBe(204);
    const starred = await json(call(bea, "GET", "?box=starred"));
    expect(starred.entries[0]).toMatchObject({ id: entry.id, starred: true, unread: false });

    const folder = await json(call(bea, "POST", "/folders", { label: "Cocina" }));
    expect((await call(bea, "POST", `/messages/${entry.id}/actions`, { action: "move", folder: folder.id })).status).toBe(204);
    expect((await json(call(bea, "GET", ""))).entries).toHaveLength(0);
    expect((await json(call(bea, "GET", `?box=${folder.id}`))).entries).toHaveLength(1);

    expect((await call(bea, "POST", "/folders", { label: "Enviados" })).status).toBe(422);
    expect((await call(ana, "DELETE", `/folders/${folder.id}`)).status).toBe(404);
    expect((await call(bea, "DELETE", `/folders/${folder.id}`)).status).toBe(204);
    expect((await json(call(bea, "GET", ""))).entries).toHaveLength(1);
  });

  it("returns 404 for unknown folders and messages", async () => {
    expect((await call(ana, "GET", `?box=${randomUUID()}`)).status).toBe(404);
    expect((await call(ana, "POST", `/messages/${randomUUID()}/actions`, { action: "read" })).status).toBe(404);
  });
});
