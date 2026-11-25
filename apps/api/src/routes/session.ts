import { createRoute, z } from "@hono/zod-openapi";
import { asUser } from "../db/client.js";
import { requireUser } from "../http/auth.js";
import { ErrorSchema } from "../http/errors.js";
import type { App, Deps } from "../http/types.js";
import { listMyHotels, needsMfa } from "../queries/access.queries.js";

const errors = {
  401: { description: "Missing, invalid or expired session.", content: { "application/json": { schema: ErrorSchema } } },
};

const Session = z
  .object({
    userId: z.uuid(),
    email: z.string().nullable(),
    /** Authenticator assurance level of this token: aal1 = password, aal2 = with second factor. */
    aal: z.string().nullable(),
    needsMfa: z.boolean().openapi({ description: "Rank-1 accounts must verify a second factor before using the workspace." }),
    mustChangePassword: z.boolean().openapi({ description: "Signed in with a temporary password; it must be changed first." }),
  })
  .openapi("Session");

const Me = z
  .object({
    userId: z.uuid(),
    email: z.string().nullable(),
    hotels: z.array(
      z.object({
        hotelKey: z.string().openapi({ example: "hotel-arts-barcelona" }),
        accessRank: z.number().int().min(1).max(3).openapi({ description: "1 = executive chef, 2 = editor, 3 = staff." }),
      }),
    ),
  })
  .openapi("Me");

export function sessionRoutes(app: App, deps: Deps) {
  const auth = requireUser(deps.auth.verifyToken);

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/session",
      tags: ["Session"],
      summary: "Session status",
      description:
        "What the client must do before opening the workspace. Works for any valid token, including sessions that still need MFA or a password change.",
      security: [{ bearer: [] }],
      middleware: [auth] as const,
      responses: { 200: { description: "Session status.", content: { "application/json": { schema: Session } } }, ...errors },
    }),
    async (c) => {
      const claims = c.var.claims;
      const [row] = await asUser(deps.pool, claims, (tx) => needsMfa.run(undefined, tx));
      const appMeta = (claims.app_metadata ?? {}) as Record<string, unknown>;
      return c.json(
        {
          userId: claims.sub,
          email: typeof claims.email === "string" ? claims.email : null,
          aal: typeof claims.aal === "string" ? claims.aal : null,
          needsMfa: row?.needsMfa ?? false,
          mustChangePassword: appMeta.compi_must_change === "true",
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/me",
      tags: ["Session"],
      summary: "Current user and hotel access",
      security: [{ bearer: [] }],
      middleware: [auth] as const,
      responses: { 200: { description: "The signed-in employee.", content: { "application/json": { schema: Me } } }, ...errors },
    }),
    async (c) => {
      const claims = c.var.claims;
      const hotels = await asUser(deps.pool, claims, (tx) => listMyHotels.run(undefined, tx));
      return c.json(
        { userId: claims.sub, email: typeof claims.email === "string" ? claims.email : null, hotels },
        200,
      );
    },
  );
}
