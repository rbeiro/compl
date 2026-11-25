import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { inject } from "vitest";
import { FAKE_SERVICE_KEY, startFakeSupabaseAuth } from "../dev/fake-supabase-auth.js";
import { createApp } from "../src/app.js";
import { createSupabaseAuthProvider } from "../src/auth/supabase-provider.js";
import { createPool, type Pool } from "../src/db/client.js";
import { createMemoryMailer } from "../src/email/mailer.js";

export const ORIGIN = "http://localhost:3000";
export const PASSWORD = "compi-dev-password";

/**
 * The API wired like production, except: Supabase Auth is the local fake
 * (real Supabase adapter talking to it) and emails are kept in memory.
 */
export async function setupApp() {
  const databaseUrl = inject("databaseUrl");
  const pool = createPool(databaseUrl);
  const fakeAuth = await startFakeSupabaseAuth({ databaseUrl });
  const mailer = createMemoryMailer();
  const app = createApp({
    pool,
    auth: createSupabaseAuthProvider({ supabaseUrl: fakeAuth.url, secretKey: FAKE_SERVICE_KEY }),
    mailer,
    config: { appUrl: "http://app.test", serverSecret: "test-server-secret-test-server-secret", corsOrigins: [ORIGIN] },
  });

  type Person = { userId: string; sessionId: string; email: string };

  /** An auth user with a live session, as Supabase Auth would create it. */
  async function createUser(email: string, opts: { mustChange?: boolean; sessionEnded?: boolean } = {}): Promise<Person> {
    const userId = randomUUID();
    const sessionId = randomUUID();
    await pool.query(
      `insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, encrypted_password)
       values ($1, $2, now(), $3, extensions.crypt($4, extensions.gen_salt('bf', 4)))`,
      [userId, email, opts.mustChange ? { compi_must_change: "true" } : {}, PASSWORD],
    );
    await pool.query(
      "insert into auth.sessions (id, user_id, not_after) values ($1, $2, case when $3 then now() - interval '1 minute' end)",
      [sessionId, userId, !!opts.sessionEnded],
    );
    return { userId, sessionId, email };
  }

  async function addStaff(p: Person, hotelKey: string, rank: 1 | 2 | 3) {
    const { rows } = await pool.query<{ id: string }>(
      `insert into public.compi_staff (hotel_key, user_id, email, employee_name, position_name, outlet_name, access_rank)
       values ($1, $2, $3, 'Test employee', 'Cocinero', 'Cocina', $4) returning id`,
      [hotelKey, p.userId, p.email, rank],
    );
    await pool.query("insert into public.compi_memberships (user_id, hotel_key) values ($1, $2)", [p.userId, hotelKey]);
    return rows[0]!.id;
  }

  /** A Supabase-style access token for `p`, signed by the fake Auth server. */
  function tokenFor(p: Person, claims: Record<string, unknown> = {}, opts: { expiresIn?: string; forged?: boolean } = {}) {
    const payload = { sub: p.userId, email: p.email, session_id: p.sessionId, app_metadata: {}, ...claims };
    if (opts.forged) {
      return new SignJWT(payload)
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer(`${fakeAuth.url}/auth/v1`)
        .setAudience("authenticated")
        .setExpirationTime("1h")
        .sign(new TextEncoder().encode("not-the-real-key-not-the-real-key-123"));
    }
    return fakeAuth.sign({ role: "authenticated", ...payload }, opts.expiresIn);
  }

  async function close() {
    await fakeAuth.stop();
    await pool.end();
  }

  return { app, pool, mailer, createUser, addStaff, tokenFor, close };
}

export const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
export const postJson = (body: unknown, token?: string): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});
// Response bodies are asserted field by field, so `any` is acceptable in tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const json = async (res: Response | Promise<Response>): Promise<any> => (await res).json();
