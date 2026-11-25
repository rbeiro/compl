import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createTokenVerifier } from "./auth/verify-token.js";
import { createSql } from "./db/client.js";
import { loadEnv } from "./env.js";

const env = loadEnv();
const sql = createSql(env.DATABASE_URL);
const app = createApp({
  sql,
  verifyToken: createTokenVerifier({ supabaseUrl: env.SUPABASE_URL, jwtSecret: env.SUPABASE_JWT_SECRET }),
  corsOrigins: env.CORS_ORIGINS,
});

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`CompI API on http://localhost:${info.port} (docs: /docs)`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    void sql.end({ timeout: 5 }).then(() => process.exit(0));
  });
}
