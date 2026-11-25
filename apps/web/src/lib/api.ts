import "server-only";
import { createApiClient } from "@compi/api-client";
import { serverEnv } from "@/lib/server-env";
import { createClient } from "@/lib/supabase/server";

/**
 * Typed CompI API client acting as the signed-in user, or null without a session.
 * The access token is read from the session cookie (refreshed by the proxy) and
 * forwarded as-is; the API verifies it, so it is not trusted here.
 */
export async function getApi() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? apiWithToken(token) : null;
}

export function apiWithToken(token: string) {
  return createApiClient({ baseUrl: serverEnv.API_URL, accessToken: () => token });
}

export type Api = ReturnType<typeof apiWithToken>;

/**
 * Where a signed-in user must go first, from GET /v1/session: two-step
 * verification (rank 1), the temporary-password change, or the workspace.
 * Returns null when the session is not valid for the API.
 */
export async function sessionDestination(api: Api) {
  const { data } = await api.GET("/v1/session");
  if (!data) return null;
  if (data.needsMfa) return "/acceso/verificacion" as const;
  if (data.mustChangePassword) return "/acceso/nueva-contrasena" as const;
  return "/portal" as const;
}
