import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { inject } from "vitest";
import { createApp } from "../src/app.js";
import { createTokenVerifier } from "../src/auth/verify-token.js";
import { createSql, type Sql } from "../src/db/client.js";

export const SUPABASE_URL = "http://supabase.test";
export const JWT_SECRET = "test-secret-test-secret-test-secret-0123";
export const ORIGIN = "http://localhost:3000";

export function setupApp() {
  const sql = createSql(inject("databaseUrl"));
  const app = createApp({
    sql,
    verifyToken: createTokenVerifier({ supabaseUrl: SUPABASE_URL, jwtSecret: JWT_SECRET }),
    corsOrigins: [ORIGIN],
  });
  return { sql, app };
}

type Person = { userId: string; sessionId: string; email: string };

/** Inserts an auth user with a live session (what Supabase Auth would create). */
export async function createUser(sql: Sql, email: string, opts: { mustChange?: boolean; sessionEnded?: boolean } = {}) {
  const userId = randomUUID();
  const sessionId = randomUUID();
  await sql`
    insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data)
    values (${userId}, ${email}, now(), ${sql.json(opts.mustChange ? { compi_must_change: "true" } : {})})
  `;
  await sql`
    insert into auth.sessions (id, user_id, not_after)
    values (${sessionId}, ${userId}, ${opts.sessionEnded ? sql`now() - interval '1 minute'` : null})
  `;
  return { userId, sessionId, email } satisfies Person;
}

export async function addStaff(sql: Sql, p: Person, hotelKey: string, rank: 1 | 2 | 3) {
  await sql`
    insert into public.compi_staff (hotel_key, user_id, email, employee_name, position_name, outlet_name, access_rank)
    values (${hotelKey}, ${p.userId}, ${p.email}, 'Test employee', 'Cocinero', 'Cocina', ${rank})
  `;
  await sql`insert into public.compi_memberships (user_id, hotel_key) values (${p.userId}, ${hotelKey})`;
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
