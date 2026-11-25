import { z } from "zod";

const schema = z
  .object({
    /**
     * Postgres connection. On Supabase use the pooler in transaction mode
     * (port 6543). Never commit it: it contains the database password.
     */
    DATABASE_URL: z.url(),
    /** Supabase project URL (Auth server). */
    SUPABASE_URL: z.url(),
    /** Supabase secret (service-role) key. Server-only: never expose it. */
    SUPABASE_SECRET_KEY: z.string().min(20),
    /** Only for projects still on the legacy shared HS256 JWT secret. */
    SUPABASE_JWT_SECRET: z.string().min(32).optional(),
    /** Resend API key. Without it, emails are printed to the console (development only). */
    RESEND_API_KEY: z.string().min(10).optional(),
    /** Sender of system emails; the domain must be verified in Resend. */
    EMAIL_FROM: z.string().min(3).default("CompI <no-reply@compichef.com>"),
    /** Public URL of the web app, for links in emails (no trailing slash). */
    APP_URL: z.url().default("http://localhost:3000"),
    /** Random secret (32+ chars) for rate-limit hashes and the invitation relay key. */
    SERVER_SECRET: z.string().min(32),
    /**
     * File storage. "s3": Supabase Storage through its S3 endpoint (or any S3
     * service). "local": files on disk, for development and tests only.
     */
    STORAGE_DRIVER: z.enum(["s3", "local"]).default("local"),
    /** e.g. https://<project-ref>.supabase.co/storage/v1/s3 */
    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().default("eu-west-1"),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    LOCAL_STORAGE_DIR: z.string().default(".storage"),
    /** Comma-separated browser origins allowed to call the API. */
    CORS_ORIGINS: z
      .string()
      .default("http://localhost:3000")
      .transform((v) => v.split(",").map((o) => o.trim()).filter(Boolean)),
    PORT: z.coerce.number().int().positive().default(8787),
    NODE_ENV: z.string().default("development"),
  })
  .refine((env) => env.NODE_ENV !== "production" || env.RESEND_API_KEY, {
    message: "RESEND_API_KEY is required in production",
    path: ["RESEND_API_KEY"],
  })
  .refine((env) => env.NODE_ENV !== "production" || env.STORAGE_DRIVER === "s3", {
    message: "STORAGE_DRIVER must be s3 in production",
    path: ["STORAGE_DRIVER"],
  })
  .refine((env) => env.STORAGE_DRIVER !== "s3" || (env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY), {
    message: "S3_ENDPOINT, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required with STORAGE_DRIVER=s3",
    path: ["S3_ENDPOINT"],
  });

export type Env = z.infer<typeof schema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid API configuration: ${fields}`);
  }
  return parsed.data;
}
