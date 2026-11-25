import type { OpenAPIHono } from "@hono/zod-openapi";
import type { VerifyToken } from "../auth/verify-token.js";
import type { Sql } from "../db/client.js";
import type { AuthVariables } from "./auth.js";

export type AppEnv = { Variables: AuthVariables };
export type App = OpenAPIHono<AppEnv>;
export type Deps = { sql: Sql; verifyToken: VerifyToken; corsOrigins: string[] };
