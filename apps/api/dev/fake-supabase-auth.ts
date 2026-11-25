// Local stand-in for Supabase Auth, for development and end-to-end checks
// without a Supabase project. NOT for production.
//
// Implements the endpoints supabase-js and the API use: password sign-in,
// refresh, user, logout and the JWKS. Tokens are ES256 like Supabase's
// asymmetric signing keys, so the web app (getClaims) and the API verify them
// exactly as in production. Users come from auth.users in DATABASE_URL; every
// seeded user's password is FAKE_AUTH_PASSWORD (default "compi-dev").
//
//   pnpm --filter @compi/api dev:auth    # http://127.0.0.1:9999
import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { exportJWK, generateKeyPair, jwtVerify, SignJWT } from "jose";
import pg from "pg";

const PORT = Number(process.env.FAKE_AUTH_PORT ?? 9999);
const BASE = `http://127.0.0.1:${PORT}`;
const ISSUER = `${BASE}/auth/v1`;
const PASSWORD = process.env.FAKE_AUTH_PASSWORD ?? "compi-dev";
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/compi_dev",
});

const { publicKey, privateKey } = await generateKeyPair("ES256");
const kid = randomUUID();
const jwks = { keys: [{ ...(await exportJWK(publicKey)), kid, alg: "ES256", use: "sig" }] };
const refreshTokens = new Map<string, { userId: string; sessionId: string }>();

type UserRow = { id: string; email: string; raw_app_meta_data: Record<string, unknown>; created_at: string };

async function issue(user: UserRow, sessionId: string) {
  const expiresIn = 3600;
  const accessToken = await new SignJWT({
    email: user.email,
    role: "authenticated",
    aal: "aal1",
    session_id: sessionId,
    app_metadata: user.raw_app_meta_data,
    user_metadata: {},
    is_anonymous: false,
  })
    .setProtectedHeader({ alg: "ES256", kid, typ: "JWT" })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(privateKey);
  const refreshToken = randomBytes(16).toString("hex");
  refreshTokens.set(refreshToken, { userId: user.id, sessionId });
  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    refresh_token: refreshToken,
    user: publicUser(user),
  };
}

const publicUser = (u: UserRow) => ({
  id: u.id,
  aud: "authenticated",
  role: "authenticated",
  email: u.email,
  app_metadata: u.raw_app_meta_data,
  user_metadata: {},
  created_at: u.created_at,
});

async function findUser(where: "email" | "id", value: string) {
  const { rows } = await pool.query<UserRow>(
    `select id, email, raw_app_meta_data, created_at from auth.users where ${where === "email" ? "lower(email) = lower($1)" : "id = $1"}`,
    [value],
  );
  return rows[0];
}

async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function send(res: ServerResponse, status: number, data?: unknown) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
  });
  res.end(data === undefined ? undefined : JSON.stringify(data));
}

const authError = (res: ServerResponse, status: number, code: string, msg: string) =>
  send(res, status, { code: status, error_code: code, msg });

async function bearerUser(req: IncomingMessage) {
  const token = req.headers.authorization?.replace(/^Bearer /i, "") ?? "";
  const { payload } = await jwtVerify(token, publicKey, { issuer: ISSUER, audience: "authenticated" });
  return { payload, user: await findUser("id", String(payload.sub)) };
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", BASE);
    if (req.method === "OPTIONS") return send(res, 204);

    if (req.method === "GET" && url.pathname === "/auth/v1/.well-known/jwks.json") return send(res, 200, jwks);

    if (req.method === "POST" && url.pathname === "/auth/v1/token") {
      const input = await body(req);
      if (url.searchParams.get("grant_type") === "password") {
        const user = await findUser("email", String(input.email ?? ""));
        if (!user || input.password !== PASSWORD) {
          return authError(res, 400, "invalid_credentials", "Invalid login credentials");
        }
        const sessionId = randomUUID();
        await pool.query("insert into auth.sessions (id, user_id, aal) values ($1, $2, 'aal1')", [sessionId, user.id]);
        return send(res, 200, await issue(user, sessionId));
      }
      if (url.searchParams.get("grant_type") === "refresh_token") {
        const entry = refreshTokens.get(String(input.refresh_token ?? ""));
        const user = entry && (await findUser("id", entry.userId));
        if (!entry || !user) return authError(res, 400, "refresh_token_not_found", "Invalid Refresh Token");
        refreshTokens.delete(String(input.refresh_token));
        return send(res, 200, await issue(user, entry.sessionId));
      }
      return authError(res, 400, "unsupported_grant_type", "Unsupported grant type");
    }

    if (req.method === "GET" && url.pathname === "/auth/v1/user") {
      const { user } = await bearerUser(req).catch(() => ({ user: undefined }));
      return user ? send(res, 200, publicUser(user)) : authError(res, 401, "bad_jwt", "Invalid token");
    }

    if (req.method === "POST" && url.pathname === "/auth/v1/logout") {
      const auth = await bearerUser(req).catch(() => null);
      if (auth) await pool.query("delete from auth.sessions where id = $1", [auth.payload.session_id]);
      return send(res, 204);
    }

    return authError(res, 404, "not_found", "Not found");
  } catch (error) {
    console.error(error);
    return authError(res, 500, "unexpected_failure", "Unexpected failure");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Fake Supabase Auth on ${BASE} (password: ${PASSWORD})`));
