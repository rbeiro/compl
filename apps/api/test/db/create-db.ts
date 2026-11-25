// Creates a local database with the production schema, for manual testing.
//   pnpm --filter @compi/api db:local     (DB_NAME defaults to compi_dev)
import { recreateDatabase } from "./load-schema.js";

const admin = process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/postgres";
console.log(await recreateDatabase(admin, process.env.DB_NAME ?? "compi_dev"));
