import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export const ErrorSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "session_expired" }),
      message: z.string().openapi({ example: "Sign in again." }),
      /** User-facing text from the database rule that rejected the request, when there is one. */
      detail: z.string().optional(),
    }),
  })
  .openapi("Error");

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
  }
}

// SQLSTATE codes raised by the CompI database functions. PT4xx follow the
// PostgREST convention the schema was written for; the rest are standard.
const fromPostgres: Record<string, [ContentfulStatusCode, string, string]> = {
  PT401: [401, "session_expired", "Sign in again."],
  PT403: [403, "forbidden", "You do not have access to this resource."],
  "42501": [403, "forbidden", "You do not have access to this resource."],
  PT404: [404, "not_found", "Not found."],
  P0002: [404, "not_found", "Not found."],
  PT409: [409, "conflict", "The request conflicts with the current state."],
  "23505": [409, "conflict", "The request conflicts with the current state."],
  PT429: [429, "rate_limited", "Too many attempts. Wait a moment and try again."],
  "22023": [422, "invalid_request", "The request is not valid."],
  "23514": [422, "invalid_request", "The request is not valid."],
  "22P02": [422, "invalid_request", "The request is not valid."],
};

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const pg = error as { code?: string; message?: string; name?: string };
  const known = pg.code ? fromPostgres[pg.code] : undefined;
  if (known) {
    const [status, code, message] = known;
    // Business-rule messages are written for end users; forward them for 4xx only.
    const detail = pg.code === "42501" ? undefined : pg.message;
    return new ApiError(status, code, message, detail);
  }
  return new ApiError(500, "internal_error", "Unexpected error.");
}

export function errorResponse(c: Context, error: unknown) {
  const e = toApiError(error);
  if (e.status >= 500) console.error(error);
  return c.json(
    { error: { code: e.code, message: e.message, ...(e.detail ? { detail: e.detail } : {}) } },
    e.status,
  );
}
