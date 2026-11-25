import { createClient, type AuthError } from "@supabase/supabase-js";
import { AuthProviderError, type AuthFailure, type AuthProvider, type Tokens } from "./provider.js";
import { createTokenVerifier } from "./verify-token.js";

/**
 * Supabase Auth implementation. Uses the secret (service-role) key, which never
 * leaves the API. Clients never talk to Supabase directly.
 */
export function createSupabaseAuthProvider(options: {
  supabaseUrl: string;
  secretKey: string;
  jwtSecret?: string;
}): AuthProvider {
  const client = createClient(options.supabaseUrl, options.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  return {
    verifyToken: createTokenVerifier({ supabaseUrl: options.supabaseUrl, jwtSecret: options.jwtSecret }),

    async signInWithPassword(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error || !data.session) throw toError(error, "invalid_credentials");
      return tokens(data.session);
    },

    async refresh(refreshToken) {
      const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
      if (error || !data.session) throw toError(error, "invalid_refresh_token");
      return tokens(data.session);
    },

    async signOut(accessToken) {
      const { error } = await client.auth.admin.signOut(accessToken, "local");
      // An already-ended session is fine: the goal is that it no longer works.
      if (error && error.status !== 401 && error.status !== 404) throw toError(error, "unavailable");
    },

    admin: {
      async createUser({ email, password, emailConfirmed, appMetadata }) {
        const { data, error } = await client.auth.admin.createUser({
          email,
          password,
          email_confirm: emailConfirmed,
          app_metadata: appMetadata,
        });
        if (error || !data.user) throw toError(error, "unavailable");
        return { id: data.user.id };
      },
      async updateUser(id, { password, emailConfirmed, appMetadata }) {
        const { error } = await client.auth.admin.updateUserById(id, {
          ...(password !== undefined ? { password } : {}),
          ...(emailConfirmed !== undefined ? { email_confirm: emailConfirmed } : {}),
          ...(appMetadata !== undefined ? { app_metadata: appMetadata } : {}),
        });
        if (error) throw toError(error, "unavailable");
      },
    },
  };
}

function tokens(session: { access_token: string; refresh_token: string; expires_at?: number; expires_in: number }): Tokens {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in,
  };
}

function toError(error: AuthError | null, fallback: AuthFailure) {
  const code = error?.code ?? "";
  const status = error?.status ?? 0;
  const kind: AuthFailure =
    code === "weak_password" ? "weak_password"
    : code === "email_exists" || code === "user_already_exists" ? "user_exists"
    : status === 429 || code === "over_request_rate_limit" ? "rate_limited"
    : code === "invalid_credentials" || code === "email_not_confirmed" ? "invalid_credentials"
    : code.startsWith("refresh_token") || code === "session_not_found" ? "invalid_refresh_token"
    : status >= 500 || status === 0 ? "unavailable"
    : fallback;
  return new AuthProviderError(kind, error?.message);
}
