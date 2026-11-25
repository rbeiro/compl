// Local stand-in for the backend of the LEGACY site (legacy/public), so its
// signed-in screens can run against the local database and be compared with
// the new app (apps/web/scripts/parity). Development only.
//
// Serves what legacy/public/portal.js calls on Supabase:
//   /auth/v1/*            → an in-process fake Supabase Auth (aal2 tokens)
//   /rest/v1/rpc/<fn>     → `public.<fn>(named args)` as the user (like PostgREST)
//   /rest/v1/<table>      → select with ?select=, ?order= and col=eq.value filters
// Playwright reroutes the legacy page's calls to the production URL here, so
// production is never contacted.
//
//   pnpm --filter @compi/api dev:legacy-backend     # http://127.0.0.1:9998
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import pg from "pg";
import { devSharedKey, startFakeSupabaseAuth } from "./fake-supabase-auth.js";

const PORT = Number(process.env.LEGACY_BACKEND_PORT ?? 9998);
const databaseUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/compi_dev";
const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
// Same key and issuer as `dev:auth` (port 9999), so the new API also accepts
// these tokens; aal2 so the legacy UI skips its authenticator-app screen.
const API_URL = process.env.LEGACY_API_URL ?? "http://127.0.0.1:8787";
const auth = await startFakeSupabaseAuth({
  databaseUrl,
  aal: "aal2",
  key: await devSharedKey(),
  issuer: process.env.LEGACY_AUTH_ISSUER ?? "http://127.0.0.1:9999/auth/v1",
});

// Legacy Edge Function file paths → the new API's equivalent endpoints.
function apiPathFor(pathname: string, search: URLSearchParams) {
  const match = /^\/functions\/v1\/compi-arts-descarga\/([a-z0-9-]+)\/([a-z0-9-]+)\/([a-z0-9-]+)\/([a-z-]+)$/.exec(pathname);
  if (!match) return null;
  const [, h, o, g, fmt] = match;
  const base = `/v1/guides/${h}/${o}/${g}`;
  if (fmt === "workspace-approved") return `${base}/media/approved`;
  if (fmt === "workspace-clean") return `${base}/media/clean`;
  if (fmt === "pdf" || fmt === "docx") return `${base}/files/${fmt}${search.get("original") === "1" ? "?original=1" : ""}`;
  return null;
}

const ident = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw Object.assign(new Error("bad identifier"), { status: 400 });
  return `"${name}"`;
};

function claimsOf(req: IncomingMessage) {
  const token = req.headers.authorization?.replace(/^Bearer /i, "") ?? "";
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return payload?.role === "authenticated" ? payload : null; // dev only: not verified
  } catch {
    return null;
  }
}

async function asUser<T>(claims: unknown, fn: (c: pg.PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('request.jwt.claims', $1, true), set_config('role', $2, true)", [
      JSON.stringify(claims ?? {}),
      claims ? "authenticated" : "anon",
    ]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function rpc(req: IncomingMessage, name: string, args: Record<string, unknown>) {
  const { rows: procs } = await pool.query<{ retset: boolean; scalar: boolean }>(
    `select p.proretset as retset, t.typtype <> 'c' and p.prorettype <> 'record'::regtype as scalar
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype
     where n.nspname = 'public' and p.proname = $1 limit 1`,
    [name],
  );
  const proc = procs[0];
  if (!proc) throw Object.assign(new Error(`function ${name} not found`), { status: 404, code: "PGRST202" });
  const keys = Object.keys(args);
  const params = keys.map((k) => {
    const v = args[k];
    return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
  });
  const call = `public.${ident(name)}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(", ")})`;
  return asUser(claimsOf(req), async (c) => {
    if (proc.retset || !proc.scalar) return (await c.query(`select * from ${call}`, params)).rows;
    return (await c.query(`select ${call} as v`, params)).rows[0]?.v ?? null;
  });
}

async function select(req: IncomingMessage, table: string, url: URL) {
  const cols = (url.searchParams.get("select") ?? "*").split(",").map((c) => (c === "*" ? "*" : ident(c.trim())));
  const where: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of url.searchParams) {
    if (["select", "order", "limit", "offset"].includes(key)) continue;
    const match = /^eq\.(.*)$/.exec(value);
    if (!match) throw Object.assign(new Error(`filter ${value} not supported`), { status: 400 });
    params.push(match[1]);
    where.push(`${ident(key)} = $${params.length}`);
  }
  const order = (url.searchParams.get("order") ?? "")
    .split(",")
    .filter(Boolean)
    .map((part) => {
      const [col, dir] = part.split(".");
      return `${ident(col!)}${dir === "desc" ? " desc" : ""}`;
    });
  const where_ = where.length ? ` where ${where.join(" and ")}` : "";
  const order_ = order.length ? ` order by ${order.join(", ")}` : "";
  const sql = `select ${cols.join(", ")} from public.${ident(table)}${where_}${order_}`;
  return asUser(claimsOf(req), async (c) => (await c.query(sql, params)).rows);
}

// PostgREST-style error status for a SQLSTATE.
function statusOf(code: string | undefined) {
  if (code && /^PT\d{3}$/.test(code)) return Number(code.slice(2));
  if (code === "42501") return 403;
  if (code === "23505") return 409;
  return 400;
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function send(res: ServerResponse, status: number, data?: unknown) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  });
  res.end(data === undefined ? undefined : JSON.stringify(data));
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "OPTIONS") return send(res, 204);
    if (url.pathname.startsWith("/auth/v1/")) {
      const upstream = await fetch(auth.url + url.pathname + url.search, {
        method: req.method,
        headers: { "content-type": "application/json", authorization: req.headers.authorization ?? "" },
        body: req.method === "GET" ? undefined : JSON.stringify(await readBody(req)),
      });
      const text = await upstream.text();
      res.writeHead(upstream.status, { "content-type": "application/json", "access-control-allow-origin": "*" });
      return res.end(text);
    }
    const apiPath = apiPathFor(url.pathname, url.searchParams);
    if (apiPath) {
      const upstream = await fetch(API_URL + apiPath, { headers: { authorization: req.headers.authorization ?? "" } });
      const headers: Record<string, string> = { "access-control-allow-origin": "*" };
      for (const name of ["content-type", "x-compi-brand-revision", "x-compi-drive-original"]) {
        const value = upstream.headers.get(name);
        if (value) headers[name] = value;
      }
      res.writeHead(upstream.status, headers);
      return res.end(Buffer.from(await upstream.arrayBuffer()));
    }
    const rpcMatch = /^\/rest\/v1\/rpc\/([a-z_0-9]+)$/.exec(url.pathname);
    if (rpcMatch && req.method === "POST") return send(res, 200, await rpc(req, rpcMatch[1]!, await readBody(req)));
    const tableMatch = /^\/rest\/v1\/([a-z_0-9]+)$/.exec(url.pathname);
    if (tableMatch && req.method === "GET") return send(res, 200, await select(req, tableMatch[1]!, url));
    return send(res, 501, { code: "PGRST501", message: `not emulated: ${req.method} ${url.pathname}` });
  } catch (error) {
    const e = error as { code?: string; message?: string; status?: number };
    return send(res, e.status ?? statusOf(e.code), { code: e.code ?? "PGRST000", message: e.message, details: null, hint: null });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Legacy backend stand-in on http://127.0.0.1:${PORT} (auth: ${auth.url})`));
