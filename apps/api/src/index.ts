// Vercel entry point. Vercel's Hono preset deploys the app exported by default
// from src/index.ts as a Vercel Function (Node.js runtime, Fluid compute).
// Local development uses src/node.ts instead.
import { attachDatabasePool } from "@vercel/functions";
import { createApp } from "./app.js";
import { createTokenVerifier } from "./auth/verify-token.js";
import { createPool } from "./db/client.js";
import { loadEnv } from "./env.js";

const env = loadEnv();
const pool = createPool(env.DATABASE_URL);
// Lets the function instance close idle connections before it is suspended.
attachDatabasePool(pool);

export default createApp({
  pool,
  verifyToken: createTokenVerifier({ supabaseUrl: env.SUPABASE_URL, jwtSecret: env.SUPABASE_JWT_SECRET }),
  corsOrigins: env.CORS_ORIGINS,
});
