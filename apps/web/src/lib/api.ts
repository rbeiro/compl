import "server-only";
import { createApiClient } from "@compi/api-client";
import { serverEnv } from "@/lib/server-env";
import { accessToken } from "@/lib/session";

/** Typed CompI API client. Server-side only: the tokens live in httpOnly cookies. */
export function apiWithToken(token?: string) {
  return createApiClient({ baseUrl: serverEnv.API_URL, accessToken: token });
}

/** Client acting as the signed-in user, or null without a session. */
export async function getApi() {
  const token = await accessToken();
  return token ? apiWithToken(token) : null;
}

export type Api = ReturnType<typeof apiWithToken>;

export type NextStep = "second_factor" | "password_change" | "workspace";

export const nextStepPath = {
  second_factor: "/acceso/verificacion",
  password_change: "/acceso/nueva-contrasena",
  workspace: "/portal",
} as const satisfies Record<NextStep, string>;

/**
 * Where a signed-in user must go first (GET /v1/session): two-step
 * verification, the temporary-password change, or the workspace.
 * Null when the session is no longer valid.
 */
export async function sessionDestination(api: Api) {
  const { data } = await api.GET("/v1/session");
  if (!data) return null;
  if (data.needsMfa) return nextStepPath.second_factor;
  if (data.mustChangePassword) return nextStepPath.password_change;
  return nextStepPath.workspace;
}
