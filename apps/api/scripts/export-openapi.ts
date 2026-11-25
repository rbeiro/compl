// Writes the OpenAPI spec to packages/api-client/openapi.json, then regenerate
// the client types with `pnpm --filter @compi/api-client generate`.
// Builds the app with inert dependencies: producing the spec needs no database.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app.js";
import type { Pool } from "../src/db/client.js";

const app = createApp({
  pool: {} as Pool,
  verifyToken: async () => {
    throw new Error("unused");
  },
  corsOrigins: [],
});
const spec = await (await app.request("/v1/openapi.json")).json();
const target = fileURLToPath(new URL("../../../packages/api-client/openapi.json", import.meta.url));
await writeFile(target, JSON.stringify(spec, null, 2) + "\n");
console.log("Wrote", target);
