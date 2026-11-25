import { createRoute, z } from "@hono/zod-openapi";
import { asUser } from "../db/client.js";
import { requireUser } from "../http/auth.js";
import { ApiError, ErrorSchema } from "../http/errors.js";
import type { App, Deps } from "../http/types.js";
import { listGuides, listOutlets } from "../queries/catalog.queries.js";

type GuideCursor = { hotelKey: string; outletKey: string; guideKey: string };

const json = (schema: z.ZodType) => ({ "application/json": { schema } });
const errors = {
  401: { description: "Missing, invalid or expired session.", content: json(ErrorSchema) },
  422: { description: "Invalid query parameters.", content: json(ErrorSchema) },
};

const Outlet = z
  .object({ hotelKey: z.string(), outletKey: z.string(), hotel: z.string(), outlet: z.string() })
  .openapi("Outlet");

const GuideState = z.enum(["draft", "ready", "archived"]);

const Guide = z
  .object({
    hotelKey: z.string(),
    outletKey: z.string(),
    guideKey: z.string(),
    hotel: z.string(),
    outlet: z.string(),
    title: z.string(),
    state: GuideState,
    kind: z.string().nullable(),
    category: z.string().nullable(),
    reviewed: z.boolean(),
    canClassify: z.boolean(),
    hasSource: z.boolean(),
    hasImage: z.boolean(),
    imageKind: z.string().nullable(),
    hasCleanImage: z.boolean(),
    station: z.string().nullable().openapi({ description: "Partida (kitchen station)." }),
    portion: z.string().nullable().openapi({ description: "Ración." }),
    pass: z.string().nullable().openapi({ description: "Pase." }),
    serviceNotes: z.string().nullable().openapi({ description: "Notes for front of house (sala), Spanish." }),
    englishName: z.string().nullable(),
  })
  .openapi("Guide");

const GuidePage = z
  .object({
    items: z.array(Guide),
    nextCursor: z.string().nullable().openapi({ description: "Pass as `cursor` to get the next page; null on the last page." }),
  })
  .openapi("GuidePage");

const GuideQuery = z.object({
  cursor: z.string().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

// Keyset pagination over (hotel, outlet, guide), as the database function expects.
const encodeCursor = (c: GuideCursor) =>
  Buffer.from(JSON.stringify([c.hotelKey, c.outletKey, c.guideKey])).toString("base64url");

function decodeCursor(value: string | undefined): GuideCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const [hotelKey, outletKey, guideKey] = z.tuple([z.string(), z.string(), z.string()]).parse(parsed);
    return { hotelKey, outletKey, guideKey };
  } catch {
    throw new ApiError(422, "invalid_request", "Invalid cursor.");
  }
}

export function catalogRoutes(app: App, deps: Deps) {
  const auth = requireUser(deps.verifyToken);

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/outlets",
      tags: ["Catalog"],
      summary: "Outlets the user can see",
      security: [{ bearer: [] }],
      middleware: [auth] as const,
      responses: {
        200: { description: "Outlets, ordered by hotel and name.", content: json(z.object({ items: z.array(Outlet) })) },
        401: errors[401],
      },
    }),
    async (c) => {
      const items = await asUser(deps.pool, c.var.claims, (tx) => listOutlets.run(undefined, tx));
      return c.json({ items }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/guides",
      tags: ["Catalog"],
      summary: "Plating guides the user can see",
      description: "Paginated. Drafts are only visible to the executive chef and to their author.",
      security: [{ bearer: [] }],
      middleware: [auth] as const,
      request: { query: GuideQuery },
      responses: { 200: { description: "A page of guides.", content: json(GuidePage) }, ...errors },
    }),
    async (c) => {
      const { cursor, limit } = c.req.valid("query");
      const after = decodeCursor(cursor);
      const rows = await asUser(deps.pool, c.var.claims, (tx) =>
        listGuides.run(
          { afterHotel: after?.hotelKey ?? "", afterOutlet: after?.outletKey ?? "", afterGuide: after?.guideKey ?? "", limit },
          tx,
        ),
      );
      const items = rows.map((row) => ({ ...row, state: GuideState.parse(row.state) }));
      const last = items.at(-1);
      return c.json({ items, nextCursor: items.length === limit && last ? encodeCursor(last) : null }, 200);
    },
  );
}
