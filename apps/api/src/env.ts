import { z } from "zod";

const schema = z.object({
  /**
   * Direct Postgres connection. On Supabase use the pooler in transaction mode
   * (port 6543). Never commit it: it contains the database password.
   */
  DATABASE_URL: z.url(),
  /** Supabase project URL; its Auth server issues and signs the access tokens. */
  SUPABASE_URL: z.url(),
  /**
   * Only for projects still on the legacy shared HS256 secret (and for tests).
   * Projects with asymmetric signing keys leave it empty: tokens are checked
   * against the project's public JWKS instead.
   */
  SUPABASE_JWT_SECRET: z.string().min(32).optional(),
  /** Comma-separated browser origins allowed to call the API. */
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000")
    .transform((v) => v.split(",").map((o) => o.trim()).filter(Boolean)),
  PORT: z.coerce.number().int().positive().default(8787),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid API configuration: ${fields}`);
  }
  return parsed.data;
}
