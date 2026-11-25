// Vercel entry point. Vercel's Hono preset deploys the app exported by default
// from src/index.ts as a Vercel Function (Node.js runtime, Fluid compute).
// Local development uses src/node.ts instead.
import { attachDatabasePool } from "@vercel/functions";
import { createApp } from "./app.js";
import { depsFromEnv } from "./deps.js";
import { loadEnv } from "./env.js";

const deps = depsFromEnv(loadEnv());
// Lets the function instance close idle connections before it is suspended.
attachDatabasePool(deps.pool);

export default createApp(deps);
