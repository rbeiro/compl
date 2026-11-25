import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addStaff, bearer, createUser, ORIGIN, setupApp, tokenFor } from "./fixtures.js";

const { pool, app } = setupApp();
const get = (path: string, init?: RequestInit) => app.request(path, init);
// Response bodies are asserted field by field below, so `any` is acceptable here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response | Promise<Response>): Promise<any> => (await res).json();

let staff: Awaited<ReturnType<typeof createUser>>;
let chef: Awaited<ReturnType<typeof createUser>>;
let editor: Awaited<ReturnType<typeof createUser>>;
let outsider: Awaited<ReturnType<typeof createUser>>;
let temporary: Awaited<ReturnType<typeof createUser>>;
let ended: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  [staff, chef, editor, outsider, temporary, ended] = await Promise.all([
    createUser(pool, "staff@compichef.com"),
    createUser(pool, "chef@compichef.com"),
    createUser(pool, "editor@compichef.com"),
    createUser(pool, "other@compichef.com"),
    createUser(pool, "temp@compichef.com", { mustChange: true }),
    createUser(pool, "ended@compichef.com", { sessionEnded: true }),
  ]);
  await addStaff(pool, staff, "hotel-arts", 3);
  await addStaff(pool, chef, "hotel-arts", 1);
  await addStaff(pool, editor, "hotel-arts", 2);
  await addStaff(pool, outsider, "hotel-otro", 3);
  await addStaff(pool, temporary, "hotel-arts", 3);
  await addStaff(pool, ended, "hotel-arts", 3);

  await pool.query(`
    insert into public.compi_arts_outlets (hotel_key, outlet_key, hotel, outlet, archived) values
      ('hotel-arts', 'enoteca', 'Hotel Arts', 'Enoteca', false),
      ('hotel-arts', 'p41', 'Hotel Arts', 'P41', false),
      ('hotel-arts', 'cerrado', 'Hotel Arts', 'Cerrado', true),
      ('hotel-otro', 'bar', 'Hotel Otro', 'Bar', false)
  `);
  await pool.query(
    `insert into public.compi_arts_guides (hotel_key, outlet_key, guide_key, hotel, outlet, title, guide_state, created_by) values
      ('hotel-arts', 'enoteca', 'arroz', 'Hotel Arts', 'Enoteca', 'Arroz', 'ready', null),
      ('hotel-arts', 'enoteca', 'borrador', 'Hotel Arts', 'Enoteca', 'Borrador', 'draft', $1),
      ('hotel-arts', 'p41', 'tartar', 'Hotel Arts', 'P41', 'Tartar', 'ready', null),
      ('hotel-arts', 'cerrado', 'viejo', 'Hotel Arts', 'Cerrado', 'Viejo', 'ready', null),
      ('hotel-otro', 'bar', 'secreto', 'Hotel Otro', 'Bar', 'Secreto', 'ready', null)`,
    [editor.userId],
  );
});

afterAll(() => pool.end());

describe("system", () => {
  it("reports liveness and database readiness", async () => {
    expect(await json(get("/v1/health"))).toEqual({ ok: true });
    expect((await get("/v1/health/ready")).status).toBe(200);
  });

  it("publishes an OpenAPI document with every route", async () => {
    const doc = await json(get("/v1/openapi.json"));
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(["/v1/health", "/v1/session", "/v1/me", "/v1/outlets", "/v1/guides"]),
    );
    expect(doc.components.securitySchemes.bearer.scheme).toBe("bearer");
  });

  it("answers CORS preflight only for allowed origins", async () => {
    const allowed = await get("/v1/me", { method: "OPTIONS", headers: { Origin: ORIGIN, "Access-Control-Request-Method": "GET" } });
    expect(allowed.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const other = await get("/v1/me", { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "GET" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("returns JSON errors for unknown routes", async () => {
    const res = await get("/v1/nope");
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: { code: "not_found", message: "Not found." } });
  });
});

describe("authentication", () => {
  it("rejects requests without a token", async () => {
    const res = await get("/v1/me");
    expect(res.status).toBe(401);
    expect((await json(res)).error.code).toBe("unauthenticated");
  });

  it("rejects tokens signed with another key, expired tokens and non-user tokens", async () => {
    const forged = await tokenFor(staff, {}, { secret: "another-secret-another-secret-0123456789" });
    const expired = await tokenFor(staff, {}, { expiresIn: "-1m" });
    const anonKey = await tokenFor(staff, { role: "anon" });
    for (const token of [forged, expired, anonKey, "not-a-jwt"]) {
      expect((await get("/v1/me", bearer(token))).status).toBe(401);
    }
  });

  it("rejects a session that was ended in Supabase Auth, even with a valid token", async () => {
    const res = await get("/v1/me", bearer(await tokenFor(ended)));
    expect(res.status).toBe(401);
    expect((await json(res)).error.code).toBe("session_expired");
  });
});

describe("GET /v1/session", () => {
  it("tells a rank-1 account with only a password that it needs MFA", async () => {
    const body = await json(get("/v1/session", bearer(await tokenFor(chef))));
    expect(body).toMatchObject({ userId: chef.userId, aal: "aal1", needsMfa: true, mustChangePassword: false });
  });

  it("clears the MFA requirement once the token is aal2", async () => {
    const body = await json(get("/v1/session", bearer(await tokenFor(chef, { aal: "aal2" }))));
    expect(body.needsMfa).toBe(false);
  });

  it("flags temporary passwords", async () => {
    const token = await tokenFor(temporary, { app_metadata: { compi_must_change: "true" } });
    const body = await json(get("/v1/session", bearer(token)));
    expect(body).toMatchObject({ needsMfa: false, mustChangePassword: true });
  });
});

describe("GET /v1/me", () => {
  it("returns the hotels and rank of the employee", async () => {
    const body = await json(get("/v1/me", bearer(await tokenFor(staff))));
    expect(body).toEqual({ userId: staff.userId, email: staff.email, hotels: [{ hotelKey: "hotel-arts", accessRank: 3 }] });
  });

  it("refuses the workspace until MFA or the password change is done (database rule)", async () => {
    expect((await get("/v1/me", bearer(await tokenFor(chef)))).status).toBe(401);
    expect((await get("/v1/me", bearer(await tokenFor(temporary)))).status).toBe(401);
    expect((await get("/v1/me", bearer(await tokenFor(chef, { aal: "aal2" })))).status).toBe(200);
  });
});

describe("GET /v1/outlets", () => {
  it("lists only the open outlets of the user's own hotel (row-level security)", async () => {
    const body = await json(get("/v1/outlets", bearer(await tokenFor(staff))));
    expect(body.items).toEqual([
      { hotelKey: "hotel-arts", outletKey: "enoteca", hotel: "Hotel Arts", outlet: "Enoteca" },
      { hotelKey: "hotel-arts", outletKey: "p41", hotel: "Hotel Arts", outlet: "P41" },
    ]);
    const other = await json(get("/v1/outlets", bearer(await tokenFor(outsider))));
    expect(other.items.map((o: { outletKey: string }) => o.outletKey)).toEqual(["bar"]);
  });
});

describe("GET /v1/guides", () => {
  const keys = (body: { items: { guideKey: string }[] }) => body.items.map((g) => g.guideKey);

  it("shows staff only published guides of open outlets in their hotel", async () => {
    const body = await json(get("/v1/guides", bearer(await tokenFor(staff))));
    expect(keys(body)).toEqual(["arroz", "tartar"]);
    expect(body.items[0]).toMatchObject({ title: "Arroz", state: "ready", canClassify: false, hasImage: false });
    expect(body.nextCursor).toBeNull();
  });

  it("shows drafts to their author and to the executive chef", async () => {
    expect(keys(await json(get("/v1/guides", bearer(await tokenFor(editor)))))).toEqual(["arroz", "borrador", "tartar"]);
    const chefToken = await tokenFor(chef, { aal: "aal2" });
    expect(keys(await json(get("/v1/guides", bearer(chefToken))))).toEqual(["arroz", "borrador", "tartar"]);
  });

  it("paginates with an opaque cursor", async () => {
    const token = await tokenFor(staff);
    const first = await json(get("/v1/guides?limit=1", bearer(token)));
    expect(keys(first)).toEqual(["arroz"]);
    const second = await json(get(`/v1/guides?limit=1&cursor=${first.nextCursor}`, bearer(token)));
    expect(keys(second)).toEqual(["tartar"]);
    const third = await json(get(`/v1/guides?limit=1&cursor=${second.nextCursor}`, bearer(token)));
    expect(third).toEqual({ items: [], nextCursor: null });
  });

  it("validates query parameters", async () => {
    const token = await tokenFor(staff);
    for (const query of ["limit=0", "limit=500", "cursor=garbage"]) {
      const res = await get(`/v1/guides?${query}`, bearer(token));
      expect(res.status).toBe(422);
      expect((await json(res)).error.code).toBe("invalid_request");
    }
  });
});
