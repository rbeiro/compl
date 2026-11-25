import { createHmac } from "node:crypto";
import type { Context } from "hono";
import { asService, type Pool } from "../db/client.js";
import { allowAuthRequest } from "../queries/auth.queries.js";
import { ApiError } from "./errors.js";

/**
 * Per-client limit for public, unauthenticated endpoints (recovery,
 * invitations), using the database buckets the legacy Edge Functions used
 * (compi_allow_auth_request: 45/min per client, 3000/min overall).
 * Only a minute-rotating HMAC of the client address is stored.
 */
export async function limitPublicRequest(
  c: Context,
  pool: Pool,
  secret: string,
  endpoint: "accept" | "recover",
) {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  const peer = c.req.header("x-real-ip") ?? forwarded ?? "unknown";
  const minute = Math.floor(Date.now() / 60_000);
  const client = createHmac("sha256", secret).update(`${minute}/${peer}`).digest("hex");
  const [row] = await asService(pool, null, (tx) => allowAuthRequest.run({ endpoint, client }, tx));
  if (!row?.allowed) throw new ApiError(429, "rate_limited", "Too many attempts. Wait a moment and try again.");
}
