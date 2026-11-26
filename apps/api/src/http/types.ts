import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AuthProvider } from "../auth/provider.js";
import type { Pool } from "../db/client.js";
import type { Mailer } from "../email/mailer.js";
import type { ObjectStore } from "../storage/object-store.js";
import type { AuthVariables } from "./auth.js";

export type AppEnv = { Variables: AuthVariables };
export type App = OpenAPIHono<AppEnv>;
export type Deps = {
  pool: Pool;
  auth: AuthProvider;
  mailer: Mailer;
  store: ObjectStore;
  config: {
    appUrl: string;
    serverSecret: string;
    corsOrigins: string[];
    /** Recipe assistant settings (OPENAI_API_KEY, COMPI_COMPOSITOR_URL…); missing ones are read from the database. */
    assistant?: Record<string, string | undefined>;
  };
  /** Outbound HTTP for the assistant's providers (replaced in tests). */
  fetch?: typeof fetch;
};
