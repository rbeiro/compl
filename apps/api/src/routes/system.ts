import { createRoute, z } from "@hono/zod-openapi";
import type { App, Deps } from "../http/types.js";

const Health = z.object({ ok: z.boolean() }).openapi("Health");

export function systemRoutes(app: App, { pool }: Deps) {
  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/health",
      tags: ["System"],
      summary: "Liveness",
      responses: { 200: { description: "The API is running.", content: { "application/json": { schema: Health } } } },
    }),
    (c) => c.json({ ok: true }, 200),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/health/ready",
      tags: ["System"],
      summary: "Readiness (database reachable)",
      responses: {
        200: { description: "Ready.", content: { "application/json": { schema: Health } } },
        503: { description: "Database unreachable.", content: { "application/json": { schema: Health } } },
      },
    }),
    async (c) => {
      try {
        await pool.query("select 1");
        return c.json({ ok: true }, 200);
      } catch {
        return c.json({ ok: false }, 503);
      }
    },
  );
}
