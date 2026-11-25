import { createSupabaseAuthProvider } from "./auth/supabase-provider.js";
import { createPool } from "./db/client.js";
import { createConsoleMailer, createResendMailer } from "./email/mailer.js";
import type { Env } from "./env.js";
import type { Deps } from "./http/types.js";

/** Production wiring from environment variables. */
export function depsFromEnv(env: Env): Deps {
  return {
    pool: createPool(env.DATABASE_URL),
    auth: createSupabaseAuthProvider({
      supabaseUrl: env.SUPABASE_URL,
      secretKey: env.SUPABASE_SECRET_KEY,
      jwtSecret: env.SUPABASE_JWT_SECRET,
    }),
    mailer: env.RESEND_API_KEY
      ? createResendMailer({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM })
      : createConsoleMailer(),
    config: { appUrl: env.APP_URL, serverSecret: env.SERVER_SECRET, corsOrigins: env.CORS_ORIGINS },
  };
}
