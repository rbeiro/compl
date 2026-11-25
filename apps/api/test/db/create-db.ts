// Creates a local database with the production schema plus demo data
// (dev/seed.sql), for local development and manual testing.
//   pnpm --filter @compi/api db:local     (DB_NAME defaults to compi_dev)
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { seedFiles } from "../../dev/seed-files.js";
import pg from "pg";
import { recreateDatabase } from "./load-schema.js";

const admin = process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/postgres";
const url = await recreateDatabase(admin, process.env.DB_NAME ?? "compi_dev");
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query(await readFile(new URL("../../dev/seed.sql", import.meta.url), "utf8"));
await client.end();
// Demo guide files in the dev API's local store (recreated with the database).
const storage = resolve(process.env.LOCAL_STORAGE_DIR ?? ".storage");
await rm(storage, { recursive: true, force: true });
await seedFiles(url, storage);
console.log(url);
