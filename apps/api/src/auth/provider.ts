import type { VerifyToken } from "./verify-token.js";

/**
 * Identity provider used by the API. Sign-in, sessions and password storage
 * live in the provider; everything CompI-specific (ranks, two-step codes,
 * recovery codes, invitations) lives in Postgres. Supabase Auth is the default
 * implementation (supabase-provider.ts); another provider only needs this
 * interface plus mirroring its users/sessions into auth.users/auth.sessions
 * (see test/db/supabase-shim.sql for the columns the schema reads).
 */
export interface AuthProvider {
  verifyToken: VerifyToken;
  signInWithPassword(email: string, password: string): Promise<Tokens>;
  refresh(refreshToken: string): Promise<Tokens>;
  /** Ends the session the access token belongs to. */
  signOut(accessToken: string): Promise<void>;
  admin: {
    createUser(input: { email: string; password: string; emailConfirmed: boolean; appMetadata?: Record<string, unknown> }): Promise<{ id: string }>;
    updateUser(id: string, input: { password?: string; emailConfirmed?: boolean; appMetadata?: Record<string, unknown> }): Promise<void>;
    /** Deletes a user; used to undo an account whose CompI registration failed. */
    deleteUser(id: string): Promise<void>;
  };
}

export type Tokens = {
  accessToken: string;
  refreshToken: string;
  /** Unix time (seconds) when the access token expires. */
  expiresAt: number;
};

export type AuthFailure =
  | "invalid_credentials"
  | "invalid_refresh_token"
  | "weak_password"
  | "user_exists"
  | "rate_limited"
  | "unavailable";

export class AuthProviderError extends Error {
  constructor(readonly kind: AuthFailure, message?: string) {
    super(message ?? kind);
  }
}
