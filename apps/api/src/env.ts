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
