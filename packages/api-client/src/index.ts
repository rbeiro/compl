import createClient, { type Middleware } from "openapi-fetch";
import type { components, paths } from "./schema";

export type { components, paths };
export type Schemas = components["schemas"];
export type ApiError = Schemas["Error"]["error"];

/**
 * Typed CompI API client. `accessToken` is the Supabase Auth access token of
 * the signed-in user (a function, so callers can refresh it between requests).
 *
 *   const api = createApiClient({ baseUrl, accessToken: () => session.access_token });
 *   const { data, error } = await api.GET("/v1/me");
 */
export function createApiClient(options: {
  baseUrl: string;
  accessToken?: () => string | undefined | Promise<string | undefined>;
  fetch?: typeof fetch;
}) {
  const client = createClient<paths>({ baseUrl: options.baseUrl, fetch: options.fetch });
  const auth: Middleware = {
    async onRequest({ request }) {
      const token = await options.accessToken?.();
      if (token) request.headers.set("Authorization", `Bearer ${token}`);
      return request;
    },
  };
  client.use(auth);
  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;
