import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, json, PASSWORD, postJson, setupApp } from "./fixtures.js";

const { app, pool, mailer, createUser, addStaff, close } = await setupApp();
const call = (path: string, init?: RequestInit) => app.request(path, init);
const signIn = (email: string, password = PASSWORD, locale = "es") =>
  call("/v1/auth/sign-in", postJson({ email, password, locale }));
const codeIn = (to: string) => mailer.last(to)?.text.match(/\b(\d{6})\b/)?.[1];

let hotel = 0;
async function employee(rank: 1 | 2 | 3, opts: { mustChange?: boolean } = {}) {
  const email = `persona${++hotel}.${rank}@compichef.com`;
  const person = await createUser(email, opts);
  await addStaff(person, "hotel-arts-barcelona", rank);
  return person;
}

afterAll(close);

describe("POST /v1/auth/sign-in", () => {
  it("rejects a wrong password with the legacy error code", async () => {
    const p = await employee(3);
    const res = await signIn(p.email, "wrong-password");
    expect(res.status).toBe(401);
    expect((await json(res)).error.code).toBe("invalid_credentials");
  });

  it("validates the request", async () => {
    expect((await call("/v1/auth/sign-in", postJson({ email: "not-an-email", password: "x" }))).status).toBe(422);
  });

  it("opens the workspace directly for staff", async () => {
    const p = await employee(3);
    const body = await json(signIn(p.email));
    expect(body).toMatchObject({ next: "workspace", codeSent: false });
    expect((await call("/v1/me", bearer(body.tokens.accessToken))).status).toBe(200);
  });
});

describe("two-step verification by email", () => {
  let chef: Awaited<ReturnType<typeof employee>>;
  let token: string;

  beforeAll(async () => {
    chef = await employee(1);
    const body = await json(signIn(chef.email, PASSWORD, "en"));
    expect(body).toMatchObject({ next: "second_factor", codeSent: true });
    token = body.tokens.accessToken;
  });

  it("emails a 6-digit code in the user's language and keeps the workspace closed", async () => {
    const email = mailer.last(chef.email)!;
    expect(email.subject).toBe("Your CompI verification code");
    expect(codeIn(chef.email)).toMatch(/^\d{6}$/);
    expect((await call("/v1/me", bearer(token))).status).toBe(401);
  });

  it("refuses a new code within 30 seconds", async () => {
    const res = await call("/v1/auth/second-factor", postJson({ locale: "es" }, token));
    expect(res.status).toBe(429);
  });

  it("rejects a wrong code, then accepts the right one and opens the workspace", async () => {
    const code = codeIn(chef.email)!;
    const wrong = code === "000000" ? "111111" : "000000";
    expect(await json(call("/v1/auth/second-factor/verify", postJson({ code: wrong }, token)))).toEqual({
      status: "invalid",
      next: null,
    });
    expect(await json(call("/v1/auth/second-factor/verify", postJson({ code }, token)))).toEqual({
      status: "verified",
      next: "workspace",
    });
    expect((await call("/v1/me", bearer(token))).status).toBe(200);
    // Used codes are gone.
    expect((await json(call("/v1/auth/second-factor/verify", postJson({ code }, token)))).status).toBe("expired");
  });

  it("verifies per session: a new sign-in needs a new code", async () => {
    const again = await json(signIn(chef.email));
    expect(again.next).toBe("second_factor");
    expect((await call("/v1/me", bearer(again.tokens.accessToken))).status).toBe(401);
  });

  it("locks the code after 5 wrong attempts", async () => {
    const other = await employee(1);
    const { tokens } = await json(signIn(other.email));
    const code = codeIn(other.email)!;
    const wrong = code === "000000" ? "111111" : "000000";
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push((await json(call("/v1/auth/second-factor/verify", postJson({ code: wrong }, tokens.accessToken)))).status);
    }
    expect(results).toEqual(["invalid", "invalid", "invalid", "invalid", "locked"]);
    expect((await json(call("/v1/auth/second-factor/verify", postJson({ code }, tokens.accessToken)))).status).toBe("locked");
  });

  it("never exposes code issuing to client roles", async () => {
    const { rows } = await pool.query(
      "select has_function_privilege('authenticated', 'compi_private.second_factor_issue()', 'execute') as can",
    );
    expect(rows[0].can).toBe(false);
  });
});

describe("temporary password change", () => {
  it("requires the change, then signs in with the new password", async () => {
    const p = await employee(3, { mustChange: true });
    const first = await json(signIn(p.email));
    expect(first.next).toBe("password_change");
    expect((await call("/v1/me", bearer(first.tokens.accessToken))).status).toBe(401);

    const short = await call("/v1/auth/password", postJson({ password: "short" }, first.tokens.accessToken));
    expect(short.status).toBe(422);

    const changed = await json(call("/v1/auth/password", postJson({ password: "una-clave-nueva-123" }, first.tokens.accessToken)));
    expect(changed.next).toBe("workspace");
    expect((await call("/v1/me", bearer(changed.tokens.accessToken))).status).toBe(200);
    // The old session is ended and the old password no longer works.
    expect((await call("/v1/me", bearer(first.tokens.accessToken))).status).toBe(401);
    expect((await signIn(p.email)).status).toBe(401);
  });
});

describe("refresh and sign-out", () => {
  it("refreshes tokens, and signing out ends the session", async () => {
    const p = await employee(3);
    const { tokens } = await json(signIn(p.email));
    const refreshed = await json(call("/v1/auth/refresh", postJson({ refreshToken: tokens.refreshToken })));
    expect(refreshed.accessToken).toBeTruthy();
    expect((await call("/v1/me", bearer(refreshed.accessToken))).status).toBe(200);

    expect((await call("/v1/auth/sign-out", { method: "POST", ...bearer(refreshed.accessToken) })).status).toBe(204);
    expect((await call("/v1/me", bearer(refreshed.accessToken))).status).toBe(401);
    const again = await call("/v1/auth/refresh", postJson({ refreshToken: refreshed.refreshToken }));
    expect(again.status).toBe(401);
  });
});

describe("personal recovery code", () => {
  it("creates a code once, and recovering with it sets a new password and ends other sessions", async () => {
    const p = await employee(3);
    const { tokens } = await json(signIn(p.email));
    expect(await json(call("/v1/account/recovery-code", bearer(tokens.accessToken)))).toEqual({ configured: false });
    const { code } = await json(call("/v1/account/recovery-code", { method: "POST", ...bearer(tokens.accessToken) }));
    expect(code).toMatch(/^[0-9A-F]{40}$/);
    expect(await json(call("/v1/account/recovery-code", bearer(tokens.accessToken)))).toEqual({ configured: true });

    // Codes are accepted grouped and lower-case, as users type them.
    const typed = code.toLowerCase().match(/.{1,5}/g).join("-");
    const res = await call("/v1/auth/recover", postJson({ email: p.email, code: typed, password: "recuperada-123" }));
    expect(res.status).toBe(204);
    expect((await call("/v1/me", bearer(tokens.accessToken))).status).toBe(401);
    expect((await signIn(p.email, "recuperada-123")).status).toBe(200);
    // Single use.
    const reuse = await call("/v1/auth/recover", postJson({ email: p.email, code, password: "otra-clave-123" }));
    expect(reuse.status).toBe(403);
  });

  it("rejects unknown codes without revealing whether the account exists", async () => {
    const code = randomBytes(20).toString("hex").toUpperCase();
    const res = await call("/v1/auth/recover", postJson({ email: "nadie@compichef.com", code, password: "loquesea-123" }));
    expect(res.status).toBe(403);
  });
});

describe("invitation acceptance", () => {
  it("creates the account, links it to the employee and lets them sign in", async () => {
    const email = "nueva.persona@compichef.com";
    const { rows } = await pool.query<{ id: string }>(
      `insert into public.compi_staff (hotel_key, email, employee_name, position_name, outlet_name, access_rank, invite_state, invite_until)
       values ('hotel-arts-barcelona', $1, 'Nueva Persona', 'Ayudante', 'Enoteca', 3, 'delivered', now() + interval '1 hour')
       returning id`,
      [email],
    );
    const ticket = "v7_" + randomBytes(32).toString("hex");
    await pool.query("insert into compi_private.lab_tickets (employee, digest) values ($1, $2)", [
      rows[0]!.id,
      createHash("sha256").update(ticket).digest(),
    ]);

    const res = await call("/v1/auth/invitations/accept", postJson({ ticket, password: "mi-clave-nueva" }));
    expect(await json(res)).toEqual({ email });
    const session = await json(signIn(email, "mi-clave-nueva"));
    expect(session.next).toBe("workspace");
    const me = await json(call("/v1/me", bearer(session.tokens.accessToken)));
    expect(me.hotels).toEqual([{ hotelKey: "hotel-arts-barcelona", accessRank: 3 }]);
    // Tickets are single use.
    expect((await call("/v1/auth/invitations/accept", postJson({ ticket, password: "mi-clave-nueva" }))).status).toBe(403);
  });
});
