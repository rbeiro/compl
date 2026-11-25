import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AuthProvider } from "../auth/provider.js";
import type { Pool } from "../db/client.js";
import type { Mailer } from "../email/mailer.js";
import type { AuthVariables } from "./auth.js";

export type AppEnv = { Variables: AuthVariables };
export type App = OpenAPIHono<AppEnv>;
export type Deps = {
  pool: Pool;
  auth: AuthProvider;
  mailer: Mailer;
  config: { appUrl: string; serverSecret: string; corsOrigins: string[] };
};
