import { createRoute, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { createHandler } from "../assistant/handler.js";
import { asService, asUser, type Claims } from "../db/client.js";
import { cleanPng } from "../documents/brand-png.js";
import { documents, InputError, recipe } from "../documents/generator/documents.js";
import { requireUser } from "../http/auth.js";
import { ApiError, ErrorSchema } from "../http/errors.js";
import type { App, Deps } from "../http/types.js";
import { listMyHotels } from "../queries/access.queries.js";
import {
  acuarelaMaster,
  assistantSettings,
  commitDocumentBrand,
  generatorOutlet,
  reserveDraft,
  saveGuideSource,
  type Json,
} from "../queries/generator.queries.js";
import { documentBrand, documentBrandRevision, guideSource } from "../queries/guides.queries.js";

// Recipe generator (legacy generator.js) and document brand (document-brand.js):
// ports of the Edge Functions compi-arts-generar-ficha, compi-arts-asistente-ficha
// and compi-arts-marca-documental.

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const error = (description: string) => ({ description, content: json(ErrorSchema) });
const bearer = [{ bearer: [] }];
const key = z.string().regex(/^[a-z0-9-]{1,200}$/);
const param = (name: string) => key.openapi({ param: { name, in: "path" } });
const OutletParams = z.object({ h: param("h"), o: param("o") });
const GuideParams = OutletParams.extend({ g: param("g") });
const errors = {
  401: error("Session ended."),
  403: error("No editing permission in this outlet."),
  409: error("Changed elsewhere; retry."),
  413: error("Too large."),
  422: error("Not valid (the detail explains)."),
};
/** Recipe data with the photo inline (base64), as legacy sent it. */
const RECIPE_BYTES = 4 * Math.ceil((8 * 1024 * 1024) / 3) + 128 * 1024;

type Brand = { accent: string; logo_png: string | null; configured: boolean; revision: number };

export function generatorRoutes(app: App, deps: Deps) {
  const { pool } = deps;
  const user = requireUser(deps.auth.verifyToken);
  const one = async <T>(claims: Claims, run: (tx: Parameters<Parameters<typeof asUser>[2]>[0]) => Promise<T[]>) =>
    (await asUser(pool, claims, run))[0];
  const tooLarge = (message: string) =>
    bodyLimit({
      maxSize: RECIPE_BYTES,
      onError: () => {
        throw new ApiError(413, "too_large", "Too large.", message);
      },
    });

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/outlets/{h}/{o}/documents",
      tags: ["Generator"],
      summary: "Render a recipe sheet as Word and PDF (editors of the outlet)",
      description:
        "Returns both files base64-encoded with the hotel's current brand. `rendition=master` renders the neutral master that is stored with drafts.",
      security: bearer,
      middleware: [user, tooLarge("Reduce el tamaño de la foto.")] as const,
      request: {
        params: OutletParams,
        query: z.object({ rendition: z.enum(["master"]).optional() }),
        body: { required: true, content: json(z.record(z.string(), z.unknown()).openapi({ description: "Recipe fields (legacy generator schema)." })) },
      },
      responses: {
        200: { description: "The files.", content: json(z.object({ docx: z.string(), pdf: z.string(), brand_revision: z.number().int() })) },
        ...errors,
      },
    }),
    async (c) => {
      const { h, o } = c.req.valid("param");
      const master = c.req.valid("query").rendition === "master";
      const claims = c.var.claims;
      const permission = () => one(claims, (tx) => generatorOutlet.run({ h, o }, tx));
      const ctx = await permission();
      if (!ctx) throw new ApiError(403, "forbidden", "No editing permission.", "Tu cuenta no tiene permiso de edición en este outlet.");
      let r: ReturnType<typeof recipe>;
      try {
        r = recipe(c.req.valid("json"));
      } catch (e) {
        if (e instanceof InputError) throw new ApiError(422, "invalid_request", "The recipe is not valid.", e.message);
        throw e;
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        const brand = (await one(claims, (tx) => documentBrand.run({ h }, tx)))!.brand as Brand;
        let files: { docx: string; pdf: string };
        try {
          files = await documents(r, { ...ctx, hotel_key: h, master, brand: master ? { accent: "345B6F", logo_png: null } : brand });
        } catch (e) {
          if (e instanceof InputError) throw new ApiError(422, "invalid_request", "The recipe is not valid.", e.message);
          throw e;
        }
        const [current, revision] = await Promise.all([permission(), one(claims, (tx) => documentBrandRevision.run({ h }, tx))]);
        if (!current) throw new ApiError(403, "forbidden", "No editing permission.");
        if (master || revision?.revision === brand.revision) return c.json({ ...files, brand_revision: revision!.revision }, 200);
      }
      throw new ApiError(409, "conflict", "The brand changed while generating; retry.");
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/outlets/{h}/{o}/drafts",
      tags: ["Generator"],
      summary: "Reserve the draft guide a generated recipe is saved to",
      description: "Idempotent per `ticket`: retries return the same guide.",
      security: bearer,
      middleware: [user] as const,
      request: {
        params: OutletParams,
        body: {
          required: true,
          content: json(z.object({ ticket: z.uuid(), label: z.string().max(200), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) })),
        },
      },
      responses: { 200: { description: "The reserved guide.", content: json(z.object({ key: z.string() })) }, ...errors },
    }),
    async (c) => {
      const { h, o } = c.req.valid("param");
      const { ticket, label, fingerprint } = c.req.valid("json");
      const row = await one(c.var.claims, (tx) => reserveDraft.run({ h, o, ticket, label, fingerprint }, tx));
      return c.json({ key: String((row!.draft as { key: string }).key) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/guides/{h}/{o}/{g}/source",
      tags: ["Generator"],
      summary: "The editable source of a generated guide",
      security: bearer,
      middleware: [user] as const,
      request: { params: GuideParams },
      responses: {
        200: { description: "Source and revision (null for guides not made with the generator).", content: json(z.object({ revision: z.uuid(), source: z.record(z.string(), z.unknown()) }).nullable()) },
        ...errors,
      },
    }),
    async (c) => {
      const row = await one(c.var.claims, (tx) => guideSource.run(c.req.valid("param"), tx));
      return c.json((row?.source ?? null) as { revision: string; source: Record<string, unknown> } | null, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/v1/guides/{h}/{o}/{g}/source",
      tags: ["Generator"],
      summary: "Save a draft's source with its staged Word and PDF",
      description: "Upload the pictures (`source/{slot}`) and both files (`stage/{fmt}`) first; this makes them visible together.",
      security: bearer,
      middleware: [user] as const,
      request: {
        params: GuideParams,
        body: {
          required: true,
          content: json(
            z.object({
              source: z.record(z.string(), z.unknown()),
              docx: z.string().regex(/^[a-f0-9]{64}$/),
              pdf: z.string().regex(/^[a-f0-9]{64}$/),
              previous: z.uuid().nullable(),
            }),
          ),
        },
      },
      responses: { 200: { description: "Saved.", content: json(z.object({ revision: z.uuid() })) }, ...errors },
    }),
    async (c) => {
      const { source, docx, pdf, previous } = c.req.valid("json");
      const row = await one(c.var.claims, (tx) => saveGuideSource.run({ ...c.req.valid("param"), source: source as Json, docx, pdf, previous }, tx));
      return c.json({ revision: String(row!.revision) }, 200);
    },
  );

  // ---- Assistant ----------------------------------------------------------------

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/outlets/{h}/{o}/assistant/{op}",
      tags: ["Generator"],
      summary: "Recipe assistant: status, watercolor, annotations, compose, prepare",
      description:
        "Port of the legacy assistant. Uses OpenAI and the image compositor configured for the deployment; responds with `{ error: code }` on failure (codes: provider_quota, provider_unavailable, invalid_image, timeout…).",
      security: bearer,
      middleware: [user, tooLarge("La imagen es demasiado grande.")] as const,
      request: {
        params: OutletParams.extend({
          op: z.enum(["status", "watercolor", "annotations", "compose", "prepare"]).openapi({ param: { name: "op", in: "path" } }),
        }),
        body: { required: true, content: json(z.record(z.string(), z.unknown())) },
      },
      responses: { 200: { description: "Operation result.", content: json(z.record(z.string(), z.unknown())) }, ...errors },
    }),
    async (c) => {
      const { h, o, op } = c.req.valid("param");
      const claims = c.var.claims;
      const handler = createHandler({
        env: (name: string) => deps.config.assistant?.[name],
        request: deps.fetch ?? fetch,
        authorize: async () => {
          if (!(await one(claims, (tx) => generatorOutlet.run({ h, o }, tx)))) {
            throw Object.assign(new Error("forbidden"), { code: "forbidden", status: 403 });
          }
        },
        masterPng: async () => (await asService(pool, null, (tx) => acuarelaMaster.run(undefined, tx)))[0]?.png ?? null,
        lookupSettings: async () => (await asService(pool, null, (tx) => assistantSettings.run(undefined, tx)))[0]?.settings ?? {},
      } as never) as unknown as (req: Request) => Promise<Response>;
      // The body was already parsed (and size-checked) by the route; hand it on as JSON.
      const req = new Request(`http://assistant/compi-arts-asistente-ficha/${h}/${o}/${op}`, {
        method: "POST",
        headers: { Authorization: c.req.header("Authorization") ?? "", "Content-Type": "application/json" },
        body: JSON.stringify(c.req.valid("json")),
        signal: c.req.raw.signal,
      });
      return (await handler(req)) as never;
    },
  );

  // ---- Document brand -------------------------------------------------------------

  const BrandSchema = z
    .object({ accent: z.string(), logo_png: z.string().nullable(), configured: z.boolean(), revision: z.number().int() })
    .passthrough()
    .openapi("DocumentBrand");

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/hotels/{h}/brand",
      tags: ["Generator"],
      summary: "The hotel's document brand (accent colour and logo)",
      security: bearer,
      middleware: [user] as const,
      request: { params: z.object({ h: param("h") }) },
      responses: { 200: { description: "The brand.", content: json(BrandSchema) }, ...errors },
    }),
    async (c) => {
      const row = await one(c.var.claims, (tx) => documentBrand.run({ h: c.req.valid("param").h }, tx));
      return c.json(row!.brand as z.infer<typeof BrandSchema>, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/v1/hotels/{h}/brand",
      tags: ["Generator"],
      summary: "Change the document brand (executive chef)",
      description: "`logo_png` is a base64 PNG (re-encoded on the server) or null; `expected_revision` is the revision that was opened.",
      security: bearer,
      middleware: [
        user,
        bodyLimit({
          maxSize: 352_000,
          onError: () => {
            throw new ApiError(413, "too_large", "Too large.");
          },
        }),
      ] as const,
      request: {
        params: z.object({ h: param("h") }),
        body: {
          required: true,
          content: json(
            z.object({
              accent: z.string().regex(/^[0-9a-fA-F]{6}$/),
              logo_png: z.string().nullable(),
              expected_revision: z.number().int().min(0).max(2147483646),
            }),
          ),
        },
      },
      responses: { 200: { description: "Saved.", content: json(BrandSchema) }, ...errors },
    }),
    async (c) => {
      const { h } = c.req.valid("param");
      const claims = c.var.claims;
      const hotels = await asUser(pool, claims, (tx) => listMyHotels.run(undefined, tx));
      if (!hotels.some((row) => row.hotelKey === h && row.accessRank === 1)) throw new ApiError(403, "forbidden", "Executive chef only.");
      const current = (await one(claims, (tx) => documentBrand.run({ h }, tx)))!.brand as Brand;
      const input = c.req.valid("json");
      let logo: string | null;
      try {
        logo = input.logo_png === null ? null : input.logo_png === current.logo_png ? current.logo_png : cleanPng(input.logo_png);
      } catch {
        throw new ApiError(422, "invalid_request", "The logo is not a valid PNG.");
      }
      const row = (
        await asService(pool, null, (tx) =>
          commitDocumentBrand.run(
            {
              h,
              accent: input.accent.toUpperCase(),
              logo,
              expectedRevision: input.expected_revision,
              sub: claims.sub,
              session: String(claims.session_id ?? ""),
              aal: String(claims.aal ?? "aal1"),
            },
            tx,
          ),
        )
      )[0];
      return c.json(row!.brand as z.infer<typeof BrandSchema>, 200);
    },
  );
}
