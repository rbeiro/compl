import { createMiddleware } from "hono/factory";
import type { VerifyToken } from "../auth/verify-token.js";
import type { Claims } from "../db/client.js";
import { ApiError } from "./errors.js";

export type AuthVariables = { claims: Claims };

/** Requires `Authorization: Bearer <Supabase access token>`. */
export function requireUser(verifyToken: VerifyToken) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const [scheme, token] = header.split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !token) {
      throw new ApiError(401, "unauthenticated", "Missing access token.");
    }
    try {
      c.set("claims", await verifyToken(token));
    } catch {
      throw new ApiError(401, "unauthenticated", "Invalid or expired access token.");
    }
    await next();
  });
}
