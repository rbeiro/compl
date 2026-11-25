import postgres from "postgres";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

/** Verified access-token claims, as issued by Supabase Auth. */
export type Claims = { sub: string; role?: string; [key: string]: unknown };

export function createSql(url: string): Sql {
  return postgres(url, {
    // Supabase's pooler (transaction mode) does not support prepared statements;
    // postgres.js 4 already defaults to not preparing, this keeps it explicit.
    prepare: false,
    max: 10,
    idle_timeout: 20,
    connection: { application_name: "compi-api" },
  });
}

/**
 * Runs `fn` in a transaction that acts as the signed-in user, exactly like
 * Supabase's own REST layer does:
 *   - `role authenticated`, so GRANTs and row-level security apply;
 *   - `request.jwt.claims`, so auth.uid() / auth.jwt() return this user.
 * Both settings are transaction-local, so pooled connections never leak them.
 * All business rules stay in the database functions; this only sets identity.
 */
export function asUser<T>(sql: Sql, claims: Claims, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`
      select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true),
             set_config('role', 'authenticated', true)
    `;
    return fn(tx);
  }) as Promise<T>;
}
