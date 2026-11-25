import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const SHIM = here("./supabase-shim.sql");
// The same migrations a new Supabase project gets (`supabase db push`).
const MIGRATIONS = here("../../../../supabase/migrations/");

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Recreates `dbName` from scratch: Supabase shim + every migration in order. */
export async function recreateDatabase(adminUrl: string, dbName: string) {
  await withClient(adminUrl, async (admin) => {
    await admin.query(`drop database if exists "${dbName}" with (force)`);
    await admin.query(`create database "${dbName}"`);
  });

  const url = new URL(adminUrl);
  url.pathname = "/" + dbName;
  await withClient(url.toString(), async (db) => {
    // A query without parameters may hold many statements (simple protocol).
    await db.query(await readFile(SHIM, "utf8"));
    const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const sql = (await readFile(MIGRATIONS + file, "utf8"))
        // Supabase Vault is provided by the shim's vault.decrypted_secrets view.
        .replace(/^CREATE EXTENSION IF NOT EXISTS "supabase_vault".*$/m, "");
      try {
        await db.query(sql);
      } catch (error) {
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }
  });
  return url.toString();
}
