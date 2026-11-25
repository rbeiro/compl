import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Claims } from "../db/client.js";

export type VerifyToken = (token: string) => Promise<Claims>;

/**
 * Verifies Supabase Auth access tokens. Sign-in, refresh, MFA and recovery stay
 * in Supabase Auth; the API only checks the token it issued.
 * - Asymmetric signing keys (default for new projects): public JWKS, cached by jose.
 * - Legacy shared secret: pass `jwtSecret` (HS256).
 */
export function createTokenVerifier(options: { supabaseUrl: string; jwtSecret?: string }): VerifyToken {
  const issuer = new URL("/auth/v1", options.supabaseUrl).toString();
  const key = options.jwtSecret
    ? new TextEncoder().encode(options.jwtSecret)
    : createRemoteJWKSet(new URL("/auth/v1/.well-known/jwks.json", options.supabaseUrl));

  return async (token) => {
    const { payload } = await jwtVerify(token, key as Parameters<typeof jwtVerify>[1], {
      issuer,
      audience: "authenticated",
      algorithms: options.jwtSecret ? ["HS256"] : ["ES256", "RS256", "EdDSA"],
    });
    return assertUserClaims(payload);
  };
}

function assertUserClaims(payload: JWTPayload): Claims {
  // The anon/service keys are JWTs too; only end-user sessions may call the API.
  if (typeof payload.sub !== "string" || payload.role !== "authenticated") {
    throw new Error("Not a user access token");
  }
  return payload as Claims;
}
