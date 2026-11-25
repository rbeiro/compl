import pg from "pg";

export type Pool = pg.Pool;
/** A connection inside a user transaction; pass it to `query.run(params, tx)`. */
export type Tx = pg.PoolClient;

/** Verified access-token claims, as issued by Supabase Auth. */
export type Claims = { sub: string; role?: string; [key: string]: unknown };

export function createPool(connectionString: string): Pool {
  return new pg.Pool({
    connectionString,
    // Serverless instances each hold a few connections; Supabase's pooler
    // (transaction mode, port 6543) multiplexes them. pg only prepares named
    // statements, so the pooler's lack of prepared-statement support is fine.
    max: 5,
    idleTimeoutMillis: 10_000,
    application_name: "compi-api",
  });
}

/**
 * Runs `fn` in a transaction that acts as the signed-in user, exactly like
 * Supabase's own REST layer does:
 *   - role `authenticated`, so GRANTs and row-level security apply;
 *   - `request.jwt.claims`, so auth.uid() / auth.jwt() return this user.
 * Both settings are transaction-local, so pooled connections never leak them.
 * All business rules stay in the database functions; this only sets identity.
 */
export async function asUser<T>(pool: Pool, claims: Claims, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    await client.query("begin");
    await client.query(
      "select set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true)",
      [JSON.stringify(claims)],
    );
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch((e: Error) => (broken = e));
    throw error;
  } finally {
    // A connection that could not roll back is discarded instead of reused.
    client.release(broken);
  }
}

/**
 * Runs `fn` in a transaction with the API's own database role (no RLS), for
 * server-only functions such as issuing two-step codes or invitation delivery.
 * When `claims` is given, auth.uid()/auth.jwt() still identify the user.
 * Only call it after the API has authorized the request.
 */
export async function asService<T>(pool: Pool, claims: Claims | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    await client.query("begin");
    if (claims) await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch((e: Error) => (broken = e));
    throw error;
  } finally {
    client.release(broken);
  }
}
