import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { inject } from "vitest";
import { createApp } from "../src/app.js";
import { createTokenVerifier } from "../src/auth/verify-token.js";
import { createPool, type Pool } from "../src/db/client.js";

export const SUPABASE_URL = "http://supabase.test";
export const JWT_SECRET = "test-secret-test-secret-test-secret-0123";
export const ORIGIN = "http://localhost:3000";

export function setupApp() {
  const pool = createPool(inject("databaseUrl"));
  const app = createApp({
    pool,
    verifyToken: createTokenVerifier({ supabaseUrl: SUPABASE_URL, jwtSecret: JWT_SECRET }),
    corsOrigins: [ORIGIN],
  });
  return { pool, app };
}

type Person = { userId: string; sessionId: string; email: string };

/** Inserts an auth user with a live session (what Supabase Auth would create). */
export async function createUser(pool: Pool, email: string, opts: { mustChange?: boolean; sessionEnded?: boolean } = {}) {
  const userId = randomUUID();
  const sessionId = randomUUID();
  await pool.query(
    "insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values ($1, $2, now(), $3)",
    [userId, email, opts.mustChange ? { compi_must_change: "true" } : {}],
  );
  await pool.query(
    "insert into auth.sessions (id, user_id, not_after) values ($1, $2, case when $3 then now() - interval '1 minute' end)",
    [sessionId, userId, !!opts.sessionEnded],
  );
  return { userId, sessionId, email } satisfies Person;
}

export async function addStaff(pool: Pool, p: Person, hotelKey: string, rank: 1 | 2 | 3) {
  await pool.query(
    `insert into public.compi_staff (hotel_key, user_id, email, employee_name, position_name, outlet_name, access_rank)
     values ($1, $2, $3, 'Test employee', 'Cocinero', 'Cocina', $4)`,
    [hotelKey, p.userId, p.email, rank],
  );
  await pool.query("insert into public.compi_memberships (user_id, hotel_key) values ($1, $2)", [p.userId, hotelKey]);
}

/** A Supabase-style access token for `p`. */
export function tokenFor(
  p: Person,
  claims: Record<string, unknown> = {},
  { secret = JWT_SECRET, expiresIn = "1h" }: { secret?: string; expiresIn?: string } = {},
) {
  return new SignJWT({
    email: p.email,
    role: "authenticated",
    aal: "aal1",
    session_id: p.sessionId,
    app_metadata: {},
    ...claims,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(p.userId)
    .setIssuer(`${SUPABASE_URL}/auth/v1`)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(secret));
}

export const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
