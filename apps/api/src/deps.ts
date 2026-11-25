import { createSupabaseAuthProvider } from "./auth/supabase-provider.js";
import { createPool } from "./db/client.js";
import { createConsoleMailer, createResendMailer } from "./email/mailer.js";
import type { Env } from "./env.js";
import type { Deps } from "./http/types.js";
import { createLocalStore } from "./storage/local-store.js";
import { createS3Store } from "./storage/s3-store.js";

/** Production wiring from environment variables. */
export function depsFromEnv(env: Env): Deps {
  const pool = createPool(env.DATABASE_URL);
  return {
    pool,
    store:
      env.STORAGE_DRIVER === "s3"
        ? createS3Store({
            endpoint: env.S3_ENDPOINT!,
            region: env.S3_REGION,
            accessKeyId: env.S3_ACCESS_KEY_ID!,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
          })
        : createLocalStore(env.LOCAL_STORAGE_DIR, pool),
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
