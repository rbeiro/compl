import type { TestProject } from "vitest/node";
import { recreateDatabase } from "./db/load-schema.js";

// Needs a PostgreSQL 15+ server. Default: local server with user/password postgres.
const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/postgres";

export default async function setup(project: TestProject) {
  project.provide("databaseUrl", await recreateDatabase(ADMIN_URL, "compi_api_test"));
}

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
