import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const SHIM = here("./supabase-shim.sql");
// The production schema as dumped from Supabase (public + compi_private).
const SCHEMA = here("../../../../supabase/inventory/remote_schema.sql");

/** Recreates `dbName` from scratch: Supabase shim + production schema. */
export async function recreateDatabase(adminUrl: string, dbName: string) {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists "${dbName}" with (force)`);
    await admin.unsafe(`create database "${dbName}"`);
  } finally {
    await admin.end();
  }

  const url = new URL(adminUrl);
  url.pathname = "/" + dbName;
  const db = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    await db.unsafe(await readFile(SHIM, "utf8")).simple();
    const schema = (await readFile(SCHEMA, "utf8"))
      // Supabase Vault is replaced by the shim's vault.decrypted_secrets view.
      .replace(/^CREATE EXTENSION IF NOT EXISTS "supabase_vault".*$/m, "");
    await db.unsafe(schema).simple();
  } finally {
    await db.end();
  }
  return url.toString();
}
