import { createHash } from "node:crypto";
import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { asUser, type Claims } from "../db/client.js";
import { readLegacyGuide } from "../documents/legacy-guide.js";
import { mediaType } from "../documents/media-type.js";
// Legacy modules (JS), shared with the former Edge Functions.
import { rebrandLegacy, UnsupportedLegacyTemplate } from "../documents/legacy/rebrand.js";
import { validateGuideFile } from "../documents/legacy/validate.js";
import { requireUser } from "../http/auth.js";
import { ApiError, ErrorSchema } from "../http/errors.js";
import type { App, Deps } from "../http/types.js";
import {
  classifyGuide,
  documentBrand,
  documentBrandRevision,
  fileAccess,
  reviewGuide,
  workspaceGuide,
  workspaceMedia,
} from "../queries/guides.queries.js";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const error = (description: string) => ({ description, content: json(ErrorSchema) });
const bearer = [{ bearer: [] }];
const binary = (type: string) => ({ [type]: { schema: z.string().openapi({ format: "binary" }) } });

const key = z.string().regex(/^[a-z0-9-]{1,200}$/);
const GuideParams = z.object({
  h: key.openapi({ param: { name: "h", in: "path" }, description: "Hotel key" }),
  o: key.openapi({ param: { name: "o", in: "path" }, description: "Outlet key" }),
  g: key.openapi({ param: { name: "g", in: "path" }, description: "Guide key" }),
});
const documentTypes = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } as const;

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const noStore = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" };

function bytes(c: Context, data: Uint8Array, type: string, extra: Record<string, string> = {}) {
  return c.body(data as unknown as ArrayBuffer, 200, {
    ...noStore,
    "Content-Type": type,
    "Content-Length": String(data.byteLength),
    ...extra,
  });
}

const AccessInfo = z.object({ path: z.string(), digest: z.string().nullable().optional(), drive_original: z.boolean().optional(), prefix: z.string().optional() });
const MediaRecord = z.object({ sha256: z.string(), slot: z.string(), revision: z.unknown(), draft: z.boolean().optional() }).nullable();

export function guideRoutes(app: App, deps: Deps) {
  const { pool, store } = deps;
  const user = requireUser(deps.auth.verifyToken);
  const one = async <T>(claims: Claims, run: (tx: Parameters<Parameters<typeof asUser>[2]>[0]) => Promise<T[]>) =>
    (await asUser(pool, claims, run))[0];

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/guides/{h}/{o}/{g}",
      tags: ["Catalog"],
      summary: "Guide detail (steps, service notes…)",
      security: bearer,
      middleware: [user] as const,
      request: { params: GuideParams },
      responses: {
        200: { description: "The guide's workspace data (null when it has none).", content: json(z.object({ data: z.record(z.string(), z.unknown()).nullable() })) },
        401: error("Session ended."),
        403: error("No access."),
      },
    }),
    async (c) => {
      const row = await one(c.var.claims, (tx) => workspaceGuide.run(c.req.valid("param"), tx));
      const guide = (row?.guide ?? null) as { data?: Record<string, unknown> } | null;
      return c.json({ data: guide?.data ?? null }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/v1/guides/{h}/{o}/{g}/review",
      tags: ["Catalog"],
      summary: "Mark a guide as reviewed (per user)",
      security: bearer,
      middleware: [user] as const,
      request: { params: GuideParams, body: { required: true, content: json(z.object({ reviewed: z.boolean() })) } },
      responses: { 200: { description: "Saved.", content: json(z.object({ reviewed: z.boolean() })) }, 401: error("Session ended."), 403: error("No access.") },
    }),
    async (c) => {
      const row = await one(c.var.claims, (tx) => reviewGuide.run({ ...c.req.valid("param"), ...c.req.valid("json") }, tx));
      return c.json({ reviewed: row?.reviewed === true }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/v1/guides/{h}/{o}/{g}/classification",
      tags: ["Catalog"],
      summary: "Classify a guide (kind and category)",
      security: bearer,
      middleware: [user] as const,
      request: {
        params: GuideParams,
        body: {
          required: true,
          content: json(
            z.object({
              kind: z.enum(["plato", "elaboracion"]).nullable(),
              category: z
                .enum(["desayunos", "entrantes", "principales", "postres", "fondos", "salsas", "bases", "guarniciones", "otros"])
                .nullable(),
            }),
          ),
        },
      },
      responses: { 204: { description: "Saved." }, 401: error("Session ended."), 403: error("Editors only.") },
    }),
    async (c) => {
      await one(c.var.claims, (tx) => classifyGuide.run({ ...c.req.valid("param"), ...c.req.valid("json") }, tx));
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/guides/{h}/{o}/{g}/media/{variant}",
      tags: ["Files"],
      summary: "Guide image: approved (annotated) or clean watercolor",
      security: bearer,
      middleware: [user] as const,
      request: { params: GuideParams.extend({ variant: z.enum(["approved", "clean"]).openapi({ param: { name: "variant", in: "path" } }) }) },
      responses: {
        200: { description: "The image.", content: { ...binary("image/png"), ...binary("image/jpeg") } },
        401: error("Session ended."),
        403: error("No access."),
        404: error("The guide has no such image."),
        409: error("The image changed while reading; retry."),
      },
    }),
    async (c) => {
      const { h, o, g, variant } = c.req.valid("param");
      const claims = c.var.claims;
      const media = async () => MediaRecord.parse((await one(claims, (tx) => workspaceMedia.run({ h, o, g, variant }, tx)))?.media ?? null);
      const asset = await media();
      const slotOk = variant === "clean" ? asset?.slot === "art" : ["photo", "image"].includes(asset?.slot ?? "");
      if (!asset || !/^[0-9a-f]{64}$/.test(asset.sha256) || !slotOk) throw new ApiError(404, "not_found", "Not found.");
      const permitted = AccessInfo.parse((await one(claims, (tx) => fileAccess.run({ h, o, g, fmt: "pdf", editing: asset.draft === true }, tx)))?.access);
      const object = await store.get("compi-arts-media", `${permitted.prefix}source/${asset.slot}/${asset.sha256}`);
      if (!object) throw new ApiError(404, "not_found", "Not found.");
      if (sha256(object.data) !== asset.sha256) throw new ApiError(409, "conflict", "The image changed; retry.");
      const latest = await media();
      if (latest?.revision !== asset.revision || latest?.sha256 !== asset.sha256 || latest?.slot !== asset.slot) {
        throw new ApiError(409, "conflict", "The image changed; retry.");
      }
      return bytes(c, object.data, mediaType(asset.slot, object.data));
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/guides/{h}/{o}/{g}/files/{fmt}",
      tags: ["Files"],
      summary: "Download the guide as PDF or Word, with the hotel's current brand",
      description:
        "Re-applies the hotel's document brand to the stored file. `original=1` returns the stored file unchanged when its legacy template cannot be re-branded.",
      security: bearer,
      middleware: [user] as const,
      request: {
        params: GuideParams.extend({ fmt: z.enum(["pdf", "docx"]).openapi({ param: { name: "fmt", in: "path" } }) }),
        query: z.object({ original: z.enum(["1"]).optional() }),
      },
      responses: {
        200: {
          description: "The document. `X-CompI-Brand-Revision` tells which brand revision it carries.",
          content: { ...binary(documentTypes.pdf), ...binary(documentTypes.docx) },
        },
        401: error("Session ended."),
        403: error("No access."),
        404: error("No such file."),
        409: error("The document or brand changed while preparing it; retry."),
        422: error("The stored template cannot be re-branded (code BRAND_TEMPLATE_UNSUPPORTED)."),
      },
    }),
    async (c) => {
      const { h, o, g, fmt } = c.req.valid("param");
      const originalIfUnsupported = c.req.valid("query").original === "1";
      const claims = c.var.claims;
      const access = async () => AccessInfo.parse((await one(claims, (tx) => fileAccess.run({ h, o, g, fmt, editing: false }, tx)))?.access);

      const info = await access();
      const object = await store.get("compi-arts-catalog", info.path);
      if (!object) throw new ApiError(404, "not_found", "Not found.");
      const data = object.data;

      if (info.drive_original) {
        if (sha256(data) !== info.digest) throw new ApiError(409, "conflict", "The document changed; retry.");
        if ((await access()).path !== info.path) throw new ApiError(409, "conflict", "The document changed; retry.");
        return bytes(c, data, documentTypes[fmt], { "X-CompI-Drive-Original": "1" });
      }
      if (!info.digest) await validateGuideFile(fmt, data);

      for (let attempt = 0; attempt < 2; attempt++) {
        const brand = (await one(claims, (tx) => documentBrand.run({ h }, tx)))!.brand as {
          accent: string;
          logo_png: string | null;
          configured: boolean;
          revision: number;
        };
        let rendered: Uint8Array;
        try {
          rendered = await rebrandLegacy(fmt, data, brand, { onlyMaster: !brand.configured });
        } catch (e) {
          if (e instanceof UnsupportedLegacyTemplate) {
            if (!originalIfUnsupported) throw new ApiError(422, "BRAND_TEMPLATE_UNSUPPORTED", "This template cannot be re-branded.", e.message);
            rendered = data;
          } else throw e;
        }
        const [final, revision] = await Promise.all([access(), one(claims, (tx) => documentBrandRevision.run({ h }, tx))]);
        if (final.path !== info.path) throw new ApiError(409, "conflict", "The document changed; retry.");
        if (revision?.revision !== brand.revision) continue;
        return bytes(c, rendered, documentTypes[fmt], { "X-CompI-Brand-Revision": String(brand.revision) });
      }
      throw new ApiError(409, "conflict", "The brand changed while preparing the document; retry.");
    },
  );

  /** The stored Word file of a published guide, verified against its recorded digest. */
  async function storedWord(claims: Claims, h: string, o: string, g: string) {
    const info = AccessInfo.parse((await one(claims, (tx) => fileAccess.run({ h, o, g, fmt: "docx", editing: false }, tx)))?.access);
    const object = await store.get("compi-arts-catalog", info.path);
    if (!object) return null;
    if (info.digest && sha256(object.data) !== info.digest) throw new ApiError(409, "conflict", "The document changed; retry.");
    return readLegacyGuide(object.data);
  }

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/guides/{h}/{o}/{g}/legacy",
      tags: ["Catalog"],
      summary: "Steps and service data read from the guide's Word file",
      description: "For guides that only exist as a Word file. `hasImage` tells whether `/legacy/image` has the dish photo.",
      security: bearer,
      middleware: [user] as const,
      request: { params: GuideParams },
      responses: {
        200: {
          description: "Data found in the document (null when it is not a readable guide).",
          content: json(z.object({ data: z.record(z.string(), z.unknown()).nullable(), hasImage: z.boolean() })),
        },
        401: error("Session ended."),
        403: error("No access."),
      },
    }),
    async (c) => {
      const { h, o, g } = c.req.valid("param");
      const guide = await storedWord(c.var.claims, h, o, g);
      return c.json({ data: guide?.data ?? null, hasImage: !!guide?.image }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/guides/{h}/{o}/{g}/legacy/image",
      tags: ["Files"],
      summary: "Dish photo embedded in the guide's Word file",
      security: bearer,
      middleware: [user] as const,
      request: { params: GuideParams },
      responses: {
        200: { description: "The photo.", content: { ...binary("image/png"), ...binary("image/jpeg") } },
        401: error("Session ended."),
        403: error("No access."),
        404: error("The document has no dish photo."),
      },
    }),
    async (c) => {
      const { h, o, g } = c.req.valid("param");
      const image = (await storedWord(c.var.claims, h, o, g))?.image;
      if (!image) throw new ApiError(404, "not_found", "Not found.");
      return bytes(c, image.bytes, image.type);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/hotels/{h}/brand/revision",
      tags: ["Documents"],
      summary: "Current revision of the hotel's document brand",
      description: "Clients poll it to refresh previews when the brand changes.",
      security: bearer,
      middleware: [user] as const,
      request: { params: z.object({ h: key.openapi({ param: { name: "h", in: "path" } }) }) },
      responses: {
        200: { description: "Revision number.", content: json(z.object({ revision: z.number().int() })) },
        401: error("Session ended."),
        403: error("No access."),
      },
    }),
    async (c) => {
      const row = await one(c.var.claims, (tx) => documentBrandRevision.run({ h: c.req.valid("param").h }, tx));
      return c.json({ revision: row?.revision ?? 0 }, 200);
    },
  );
}
