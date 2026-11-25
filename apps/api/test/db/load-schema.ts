import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const SHIM = here("./supabase-shim.sql");
// The production schema as dumped from Supabase (public + compi_private).
const SCHEMA = here("../../../../supabase/inventory/remote_schema.sql");

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Recreates `dbName` from scratch: Supabase shim + production schema. */
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
    const schema = (await readFile(SCHEMA, "utf8"))
      // Supabase Vault is replaced by the shim's vault.decrypted_secrets view.
      .replace(/^CREATE EXTENSION IF NOT EXISTS "supabase_vault".*$/m, "");
    await db.query(schema);
  });
  return url.toString();
}
