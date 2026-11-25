// Local stand-in for Supabase Auth (GoTrue), for development, tests and
// end-to-end checks without a Supabase project. NOT for production.
//
// Implements the endpoints the API's Supabase adapter uses through
// @supabase/supabase-js: password and refresh-token grants, logout, user, admin
// create/update and the JWKS. Like Supabase it keeps users in auth.users
// (bcrypt hashes via pgcrypto) and sessions in auth.sessions, so the database
// triggers and functions see the same data as in production. Tokens are ES256
// with a published JWKS, like Supabase's asymmetric signing keys.
//
//   pnpm --filter @compi/api dev:auth      # http://127.0.0.1:9999
import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { exportJWK, generateKeyPair, jwtVerify, SignJWT } from "jose";
import pg from "pg";

export const FAKE_SERVICE_KEY = "fake-service-role-key";

type UserRow = {
  id: string;
  email: string;
  raw_app_meta_data: Record<string, unknown>;
  email_confirmed_at: string | null;
  created_at: string;
};

class GoTrueError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export async function startFakeSupabaseAuth(options: { port?: number; databaseUrl: string }) {
  const pool = new pg.Pool({ connectionString: options.databaseUrl, max: 3 });
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const kid = randomUUID();
  const jwks = { keys: [{ ...(await exportJWK(publicKey)), kid, alg: "ES256", use: "sig" }] };
  const refreshTokens = new Map<string, { userId: string; sessionId: string }>();
  // Password sign-in time per session, reported in the `amr` claim like Supabase.
  const signedInAt = new Map<string, number>();
  let issuer = "";

  const columns = "id, email, raw_app_meta_data, email_confirmed_at, created_at";
  const publicUser = (u: UserRow) => ({
    id: u.id,
    aud: "authenticated",
    role: "authenticated",
    email: u.email,
    email_confirmed_at: u.email_confirmed_at,
    app_metadata: u.raw_app_meta_data,
    user_metadata: {},
    created_at: u.created_at,
  });

  async function issue(user: UserRow, sessionId: string) {
    const expiresIn = 3600;
    const accessToken = await new SignJWT({
      email: user.email,
      role: "authenticated",
      aal: "aal1",
      session_id: sessionId,
      amr: [{ method: "password", timestamp: signedInAt.get(sessionId) ?? Math.floor(Date.now() / 1000) }],
      app_metadata: user.raw_app_meta_data,
      user_metadata: {},
      is_anonymous: false,
    })
      .setProtectedHeader({ alg: "ES256", kid, typ: "JWT" })
      .setSubject(user.id)
      .setIssuer(issuer)
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

  async function user(id: string) {
    const { rows } = await pool.query<UserRow>(`select ${columns} from auth.users where id = $1`, [id]);
    if (!rows[0]) throw new GoTrueError(404, "user_not_found", "User not found");
    return rows[0];
  }

  async function bearer(req: IncomingMessage) {
    const token = req.headers.authorization?.replace(/^Bearer /i, "") ?? "";
    try {
      const { payload } = await jwtVerify(token, publicKey, { issuer, audience: "authenticated" });
      return payload;
    } catch {
      throw new GoTrueError(401, "bad_jwt", "Invalid JWT");
    }
  }

  function requireService(req: IncomingMessage) {
    const auth = req.headers.authorization?.replace(/^Bearer /i, "");
    if (auth !== FAKE_SERVICE_KEY) throw new GoTrueError(403, "not_admin", "User not allowed");
  }

  function checkPassword(password: unknown): asserts password is string {
    if (typeof password !== "string" || password.length < 8) {
      throw new GoTrueError(422, "weak_password", "Password should be at least 8 characters.");
    }
  }

  async function updateUser(id: string, input: Record<string, unknown>) {
    if (input.password !== undefined) checkPassword(input.password);
    // auth.users triggers (recovery, invitations) run inside this statement,
    // as they do in Supabase.
    await pool.query(
      `update auth.users set
         encrypted_password = coalesce(extensions.crypt($2, extensions.gen_salt('bf', 4)), encrypted_password),
         raw_app_meta_data = raw_app_meta_data || coalesce($3::jsonb, '{}'),
         email_confirmed_at = case when $4 then coalesce(email_confirmed_at, now()) else email_confirmed_at end,
         updated_at = now()
       where id = $1`,
      [id, (input.password as string | undefined) ?? null, input.app_metadata ?? null, input.email_confirm === true],
    ).catch((e: Error) => {
      throw new GoTrueError(422, "unexpected_failure", e.message);
    });
    return user(id);
  }

  async function body(req: IncomingMessage) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
  }

  async function route(req: IncomingMessage, url: URL): Promise<[number, unknown?]> {
    const path = url.pathname.replace(/^\/auth\/v1/, "");
    const method = req.method ?? "GET";

    if (method === "GET" && path === "/.well-known/jwks.json") return [200, jwks];

    if (method === "POST" && path === "/token") {
      const input = await body(req);
      const grant = url.searchParams.get("grant_type");
      if (grant === "password") {
        const { rows } = await pool.query<UserRow>(
          `select ${columns} from auth.users
           where lower(email) = lower($1) and email_confirmed_at is not null
             and encrypted_password is not null and encrypted_password = extensions.crypt($2, encrypted_password)`,
          [String(input.email ?? ""), String(input.password ?? "")],
        );
        const found = rows[0];
        if (!found) throw new GoTrueError(400, "invalid_credentials", "Invalid login credentials");
        const sessionId = randomUUID();
        await pool.query("insert into auth.sessions (id, user_id, aal) values ($1, $2, 'aal1')", [sessionId, found.id]);
        signedInAt.set(sessionId, Math.floor(Date.now() / 1000));
        return [200, await issue(found, sessionId)];
      }
      if (grant === "refresh_token") {
        const entry = refreshTokens.get(String(input.refresh_token ?? ""));
        if (!entry) throw new GoTrueError(400, "refresh_token_not_found", "Invalid Refresh Token");
        refreshTokens.delete(String(input.refresh_token));
        const { rowCount } = await pool.query("select 1 from auth.sessions where id = $1", [entry.sessionId]);
        if (!rowCount) throw new GoTrueError(400, "session_not_found", "Session not found");
        return [200, await issue(await user(entry.userId), entry.sessionId)];
      }
      throw new GoTrueError(400, "validation_failed", "Unsupported grant type");
    }

    if (method === "POST" && path === "/logout") {
      const claims = await bearer(req);
      const scope = url.searchParams.get("scope") ?? "global";
      if (scope === "local") await pool.query("delete from auth.sessions where id = $1", [claims.session_id]);
      else await pool.query("delete from auth.sessions where user_id = $1", [claims.sub]);
      return [204];
    }

    if (method === "GET" && path === "/user") return [200, publicUser(await user(String((await bearer(req)).sub)))];

    if (path.startsWith("/admin/users")) {
      requireService(req);
      const id = path.split("/")[3];
      if (method === "POST" && !id) {
        const input = await body(req);
        checkPassword(input.password);
        const email = String(input.email ?? "").toLowerCase();
        const exists = await pool.query("select 1 from auth.users where lower(email) = $1", [email]);
        if (exists.rowCount) throw new GoTrueError(422, "email_exists", "A user with this email already exists");
        const created = await pool
          .query<{ id: string }>(
            `insert into auth.users (email, encrypted_password, email_confirmed_at, raw_app_meta_data)
             values ($1, extensions.crypt($2, extensions.gen_salt('bf', 4)), case when $3 then now() end, $4)
             returning id`,
            [email, input.password, input.email_confirm === true, input.app_metadata ?? {}],
          )
          .catch((e: Error) => {
            throw new GoTrueError(422, "unexpected_failure", e.message);
          });
        return [200, publicUser(await user(created.rows[0]!.id))];
      }
      if (method === "PUT" && id) return [200, publicUser(await updateUser(id, await body(req)))];
      if (method === "GET" && id) return [200, publicUser(await user(id))];
    }

    throw new GoTrueError(404, "not_found", "Not found");
  }

  function send(res: ServerResponse, status: number, data?: unknown) {
    res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(data === undefined ? undefined : JSON.stringify(data));
  }

  const server: Server = createServer(async (req, res) => {
    try {
      const [status, data] = await route(req, new URL(req.url ?? "/", "http://localhost"));
      send(res, status, data);
    } catch (error) {
      if (error instanceof GoTrueError) {
        send(res, error.status, { code: error.status, error_code: error.code, msg: error.message });
      } else {
        console.error(error);
        send(res, 500, { code: 500, error_code: "unexpected_failure", msg: "Unexpected failure" });
      }
    }
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  const url = `http://127.0.0.1:${port}`;
  issuer = `${url}/auth/v1`;

  return {
    url,
    /** Signs a token with this server's key (tests use it to craft claims). */
    sign(claims: Record<string, unknown> & { sub: string }, expiresIn = "1h") {
      const { sub, ...rest } = claims;
      return new SignJWT({ role: "authenticated", aal: "aal1", ...rest })
        .setProtectedHeader({ alg: "ES256", kid, typ: "JWT" })
        .setSubject(sub)
        .setIssuer(issuer)
        .setAudience("authenticated")
        .setIssuedAt()
        .setExpirationTime(expiresIn)
        .sign(privateKey);
    },
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      await pool.end();
    },
  };
}

// CLI: pnpm --filter @compi/api dev:auth
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const auth = await startFakeSupabaseAuth({
    port: Number(process.env.FAKE_AUTH_PORT ?? 9999),
    databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/compi_dev",
  });
  console.log(`Fake Supabase Auth on ${auth.url} (service key: ${FAKE_SERVICE_KEY})`);
}
