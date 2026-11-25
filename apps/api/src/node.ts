import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { depsFromEnv } from "./deps.js";
import { loadEnv } from "./env.js";

const env = loadEnv();
const deps = depsFromEnv(env);
const app = createApp(deps);

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`CompI API on http://localhost:${info.port} (docs: /docs)`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    void deps.pool.end().then(() => process.exit(0));
  });
}
