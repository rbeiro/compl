import { createRoute, z } from "@hono/zod-openapi";
import { asUser } from "../db/client.js";
import { requireUser } from "../http/auth.js";
import { ApiError, ErrorSchema } from "../http/errors.js";
import type { App, Deps } from "../http/types.js";
import { listMyHotels } from "../queries/access.queries.js";
import { costOverview, recipeCost, saveRecipeCost, type Json } from "../queries/costs.queries.js";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const error = (description: string) => ({ description, content: json(ErrorSchema) });
const bearer = [{ bearer: [] }];
const key = z.string().regex(/^[a-z0-9-]{1,200}$/);
const pathParam = (name: string) => key.openapi({ param: { name, in: "path" } });
const guideParams = z.object({ h: pathParam("h"), o: pathParam("o"), g: pathParam("g") });

const Ingredient = z.object({
  name: z.string(),
  quantity: z.number().nullable(),
  unit: z.string(),
  price: z.number().nullable(),
  priceUnit: z.string(),
});
const CostSettings = z
  .object({
    servings: z.number().nullable(),
    baseServings: z.number().nullable(),
    salePrice: z.number().nullable(),
    ingredients: z.array(Ingredient).max(40),
  })
  .openapi("CostSettings", {
    description: "Quantities belong to `baseServings` portions; prices are per purchase unit, without VAT.",
  });
const RecipeCost = z
  .object({
    revision: z.uuid().nullable(),
    settings: CostSettings.nullable().openapi({ description: "Null until the first save." }),
    ingredientes: z.array(z.record(z.string(), z.unknown())).openapi({ description: "Ingredients of the recipe sheet, to start from." }),
  })
  .openapi("RecipeCost");

/** The Plaza costing template (Hotel Arts), a content-addressed JSON object in the catalog bucket. */
export const PLAZA_TEMPLATE = {
  hotel: "hotel-arts-barcelona",
  bucket: "compi-arts-catalog",
  key: "arts-plaza/plantilla/b8cb75011a6699965b81c427b312908bf8d2cd720504936044d8aaedd6189a1c.json",
};

const errors = {
  401: error("Session ended."),
  403: error("Executive chef (rank 1) of the hotel only."),
  409: error("Saved elsewhere since it was opened."),
  422: error("Not valid."),
};

export function costRoutes(app: App, deps: Deps) {
  const user = requireUser(deps.auth.verifyToken);

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/guides/{h}/{o}/{g}/cost",
      tags: ["Costs"],
      summary: "A recipe's cost sheet",
      security: bearer,
      middleware: [user] as const,
      request: { params: guideParams },
      responses: { 200: { description: "The cost sheet.", content: json(RecipeCost) }, ...errors },
    }),
    async (c) => {
      const [row] = await asUser(deps.pool, c.var.claims, (tx) => recipeCost.run(c.req.valid("param"), tx));
      return c.json(RecipeCost.parse(row?.cost), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/v1/guides/{h}/{o}/{g}/cost",
      tags: ["Costs"],
      summary: "Save a recipe's cost sheet",
      description: "`previous` is the revision that was opened (null for the first save).",
      security: bearer,
      middleware: [user] as const,
      request: {
        params: guideParams,
        body: { required: true, content: json(z.object({ settings: CostSettings, previous: z.uuid().nullable() })) },
      },
      responses: { 200: { description: "Saved.", content: json(z.object({ revision: z.uuid() })) }, ...errors },
    }),
    async (c) => {
      const { settings, previous } = c.req.valid("json");
      const [row] = await asUser(deps.pool, c.var.claims, (tx) =>
        saveRecipeCost.run({ ...c.req.valid("param"), settings: settings as unknown as Json, previous }, tx),
      );
      return c.json({ revision: row!.revision }, 200);
    },
  );

  const Overview = z.object({
    hotelKey: z.string(),
    outletKey: z.string(),
    guideKey: z.string(),
    settings: CostSettings.nullable(),
    ingredientCount: z.number().int().nullable(),
  });
  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/costs/overview",
      tags: ["Costs"],
      summary: "Cost status of up to 200 recipes",
      security: bearer,
      middleware: [user] as const,
      request: {
        body: {
          required: true,
          content: json(z.object({ guides: z.array(z.object({ h: key, o: key, g: key })).min(1).max(200) })),
        },
      },
      responses: { 200: { description: "One item per guide.", content: json(z.object({ items: z.array(Overview) })) }, ...errors },
    }),
    async (c) => {
      const { guides } = c.req.valid("json");
      const rows = await asUser(deps.pool, c.var.claims, (tx) => costOverview.run({ guides: JSON.stringify(guides) }, tx));
      return c.json({ items: z.array(Overview).parse(rows) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/costs/plaza",
      tags: ["Costs"],
      summary: "Plaza costing template (Hotel Arts)",
      description: "Recipes, ingredients, purchase tariffs and standards extracted from the kitchen's spreadsheet. Executive chef of Hotel Arts only.",
      security: bearer,
      middleware: [user] as const,
      responses: {
        200: { description: "The template (JSON).", content: { "application/json": { schema: z.record(z.string(), z.unknown()) } } },
        404: error("The template is not stored in this environment."),
        ...errors,
      },
    }),
    async (c) => {
      const hotels = await asUser(deps.pool, c.var.claims, (tx) => listMyHotels.run(undefined, tx));
      if (!hotels.some((h) => h.hotelKey === PLAZA_TEMPLATE.hotel && h.accessRank === 1)) {
        throw new ApiError(403, "forbidden", "You do not have access to this resource.");
      }
      const object = await deps.store.get(PLAZA_TEMPLATE.bucket, PLAZA_TEMPLATE.key);
      if (!object) throw new ApiError(404, "not_found", "Not found.");
      c.header("Cache-Control", "private, no-store");
      return c.body(object.data as Uint8Array<ArrayBuffer>, 200, { "Content-Type": "application/json; charset=utf-8" }) as never;
    },
  );
}
