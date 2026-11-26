import { createHash } from "node:crypto";
import { createRoute, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { asUser, type Claims } from "../db/client.js";
import { InvalidGuideFile, validateGuideFile } from "../documents/legacy/validate.js";
import { InvalidMedia, mediaType } from "../documents/media-type.js";
import { requireUser } from "../http/auth.js";
import { ApiError, ErrorSchema } from "../http/errors.js";
import type { App, Deps } from "../http/types.js";
import { catalogChange, commitFile, fileAccess, guideSource, stageAccess } from "../queries/guides.queries.js";
import { MAX_OBJECT_BYTES } from "../storage/object-store.js";

// Editing the catalog (legacy management.js folder/guide controls) and
// uploading guide files (legacy Edge Function compi-arts-subir-ficha).

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const error = (description: string) => ({ description, content: json(ErrorSchema) });
const bearer = [{ bearer: [] }];
const key = z.string().regex(/^[a-z0-9-]{1,200}$/);
const param = (name: string) => key.openapi({ param: { name, in: "path" } });
const GuideParams = z.object({ h: param("h"), o: param("o"), g: param("g") });
const fmtParam = z.enum(["pdf", "docx"]).openapi({ param: { name: "fmt", in: "path" } });
const slotParam = z.enum(["original", "photo", "art", "image"]).openapi({ param: { name: "slot", in: "path" } });
const documentTypes = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } as const;
const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const Access = z.object({ prefix: z.string(), digest: z.string().nullable().optional(), path: z.string() });
const Stored = z.object({ sha256: z.string(), ruta: z.string() }).openapi("StoredObject");

const errors = {
  401: error("Session ended."),
  403: error("No permission for this guide or folder."),
  404: error("Folder or guide not found."),
  409: error("Changed elsewhere (the detail explains)."),
  413: error("Larger than 10 MB."),
  422: error("Not a valid file or name (the detail explains)."),
};
const binaryBody = (description: string) => ({
  required: true,
  description,
  content: { "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) } },
});

export function editingRoutes(app: App, deps: Deps) {
  const { pool, store } = deps;
  const user = requireUser(deps.auth.verifyToken);
  const limit = bodyLimit({
    maxSize: MAX_OBJECT_BYTES,
    onError: () => {
      throw new ApiError(413, "too_large", "Larger than 10 MB.", "Archivo demasiado grande.");
    },
  });
  const one = async <T>(claims: Claims, run: (tx: Parameters<Parameters<typeof asUser>[2]>[0]) => Promise<T[]>) =>
    (await asUser(pool, claims, run))[0];
  const readBody = async (request: Request) => {
    const data = new Uint8Array(await request.arrayBuffer());
    if (data.length < 4) throw new ApiError(422, "invalid_request", "The request is not valid.", "Archivo vacío.");
    return data;
  };
  const validDocument = async (fmt: "pdf" | "docx", data: Uint8Array) => {
    try {
      await validateGuideFile(fmt, data);
    } catch (e) {
      if (e instanceof InvalidGuideFile) throw new ApiError(422, "invalid_file", "The file is not valid.", e.message);
      throw e;
    }
  };

  // ---- Files -----------------------------------------------------------------

  app.openapi(
    createRoute({
      method: "put",
      path: "/v1/guides/{h}/{o}/{g}/files/{fmt}",
      tags: ["Files"],
      summary: "Upload or replace a guide's PDF or Word file (editors)",
      description:
        "The file is validated (format and contents, up to 10 MB) and stored by content. Pass `previous` (the digest that was opened) to refuse replacing a file someone else changed meanwhile.",
      security: bearer,
      middleware: [user, limit] as const,
      request: {
        params: GuideParams.extend({ fmt: fmtParam }),
        query: z.object({ previous: z.string().regex(/^[a-f0-9]{64}$/).optional() }),
        body: binaryBody("The PDF or .docx file."),
      },
      responses: { 204: { description: "Stored and committed." }, ...errors },
    }),
    async (c) => {
      const { h, o, g, fmt } = c.req.valid("param");
      const { previous } = c.req.valid("query");
      const claims = c.var.claims;
      const info = Access.parse((await one(claims, (tx) => fileAccess.run({ h, o, g, fmt, editing: true }, tx)))?.access);
      const data = await readBody(c.req.raw);
      await validDocument(fmt, data);
      const sha = sha256(data);
      if (previous && info.digest && info.digest !== previous && info.digest !== sha) {
        throw new ApiError(409, "conflict", "The file changed.", "El archivo ha cambiado. Vuelve a abrir la ficha.");
      }
      await store.put("compi-arts-catalog", `${info.prefix}validated/${sha}/ficha.${fmt}`, data, documentTypes[fmt]);
      await one(claims, (tx) => commitFile.run({ h, o, g, fmt, sha, previous: info.digest ?? null }, tx));
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/guides/{h}/{o}/{g}/stage/{fmt}",
      tags: ["Files"],
      summary: "Store a generated draft file without committing it (recipe generator)",
      security: bearer,
      middleware: [user, limit] as const,
      request: { params: GuideParams.extend({ fmt: fmtParam }), body: binaryBody("The PDF or .docx file.") },
      responses: { 200: { description: "Stored.", content: json(Stored) }, ...errors },
    }),
    async (c) => {
      const { h, o, g, fmt } = c.req.valid("param");
      const info = Access.parse((await one(c.var.claims, (tx) => stageAccess.run({ h, o, g, fmt }, tx)))?.access);
      const data = await readBody(c.req.raw);
      await validDocument(fmt, data);
      const sha = sha256(data);
      const ruta = `${info.prefix}validated/${sha}/ficha.${fmt}`;
      await store.put("compi-arts-catalog", ruta, data, documentTypes[fmt]);
      return c.json({ sha256: sha, ruta }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/v1/guides/{h}/{o}/{g}/source/{slot}",
      tags: ["Files"],
      summary: "Store a source picture of a draft (recipe generator)",
      description: "`original` accepts JPEG, PNG, WebP and HEIC/HEIF; `photo` JPEG; `art` and `image` PNG.",
      security: bearer,
      middleware: [user, limit] as const,
      request: { params: GuideParams.extend({ slot: slotParam }), body: binaryBody("The image.") },
      responses: { 200: { description: "Stored.", content: json(Stored) }, ...errors },
    }),
    async (c) => {
      const { h, o, g, slot } = c.req.valid("param");
      const info = Access.parse((await one(c.var.claims, (tx) => stageAccess.run({ h, o, g, fmt: "docx" }, tx)))?.access);
      const data = await readBody(c.req.raw);
      let type: string;
      try {
        type = mediaType(slot, data);
      } catch (e) {
        if (e instanceof InvalidMedia) throw new ApiError(422, "invalid_file", "The image is not valid.", e.message);
        throw e;
      }
      const sha = sha256(data);
      const ruta = `${info.prefix}source/${slot}/${sha}`;
      await store.put("compi-arts-media", ruta, data, type);
      return c.json({ sha256: sha, ruta }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/guides/{h}/{o}/{g}/source/{slot}",
      tags: ["Files"],
      summary: "Read a source picture recorded in the guide's source (recipe generator)",
      security: bearer,
      middleware: [user] as const,
      request: {
        params: GuideParams.extend({ slot: slotParam }),
        query: z.object({ sha: z.string().regex(/^[a-f0-9]{64}$/) }),
      },
      responses: {
        200: { description: "The picture.", content: { "image/*": { schema: z.string().openapi({ format: "binary" }) } } },
        ...errors,
      },
    }),
    async (c) => {
      const { h, o, g, slot } = c.req.valid("param");
      const { sha } = c.req.valid("query");
      const claims = c.var.claims;
      await one(claims, (tx) => fileAccess.run({ h, o, g, fmt: "docx", editing: true }, tx));
      const read = async () =>
        (await one(claims, (tx) => guideSource.run({ h, o, g }, tx)))?.source as
          | { revision?: unknown; source?: { assets?: Record<string, { sha256?: string; ruta?: string }> } }
          | null;
      const record = await read();
      const asset = record?.source?.assets?.[slot];
      if (!asset?.ruta || asset.sha256 !== sha) throw new ApiError(404, "not_found", "Not found.");
      const object = await store.get("compi-arts-media", asset.ruta);
      if (!object) throw new ApiError(404, "not_found", "Not found.");
      if ((await read())?.revision !== record?.revision) throw new ApiError(409, "conflict", "The guide changed; retry.");
      return c.body(object.data as unknown as ArrayBuffer, 200, {
        "Content-Type": object.contentType ?? "application/octet-stream",
        "Cache-Control": "private, no-store",
      }) as never;
    },
  );

  // ---- Catalog (folders and guides) --------------------------------------------

  const change = async (claims: Claims, h: string, o: string, g: string, op: string, label = "") =>
    (await one(claims, (tx) => catalogChange.run({ h, o, g, op, label }, tx)))?.key ?? null;
  const Name = z.object({ name: z.string().max(200) });
  const Key = z.object({ key: z.string() });

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/hotels/{h}/outlets",
      tags: ["Catalog"],
      summary: "Create an outlet folder (executive chef)",
      security: bearer,
      middleware: [user] as const,
      request: { params: z.object({ h: param("h") }), body: { required: true, content: json(Name) } },
      responses: { 201: { description: "Created.", content: json(Key) }, ...errors },
    }),
    async (c) => c.json({ key: (await change(c.var.claims, c.req.valid("param").h, "", "", "new_folder", c.req.valid("json").name))! }, 201),
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/v1/hotels/{h}/outlets/{o}",
      tags: ["Catalog"],
      summary: "Rename an outlet folder (executive chef)",
      security: bearer,
      middleware: [user] as const,
      request: { params: z.object({ h: param("h"), o: param("o") }), body: { required: true, content: json(Name) } },
      responses: { 204: { description: "Renamed." }, ...errors },
    }),
    async (c) => {
      const { h, o } = c.req.valid("param");
      await change(c.var.claims, h, o, "", "rename_folder", c.req.valid("json").name);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/v1/hotels/{h}/outlets/{o}",
      tags: ["Catalog"],
      summary: "Remove an outlet folder from the portal (executive chef); its guides are hidden",
      security: bearer,
      middleware: [user] as const,
      request: { params: z.object({ h: param("h"), o: param("o") }) },
      responses: { 204: { description: "Removed." }, ...errors },
    }),
    async (c) => {
      const { h, o } = c.req.valid("param");
      await change(c.var.claims, h, o, "", "delete_folder");
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/hotels/{h}/outlets/{o}/guides",
      tags: ["Catalog"],
      summary: "Create a draft plating guide (editors)",
      security: bearer,
      middleware: [user] as const,
      request: { params: z.object({ h: param("h"), o: param("o") }), body: { required: true, content: json(Name) } },
      responses: { 201: { description: "Created.", content: json(Key) }, ...errors },
    }),
    async (c) => {
      const { h, o } = c.req.valid("param");
      return c.json({ key: (await change(c.var.claims, h, o, "", "new_guide", c.req.valid("json").name))! }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/v1/guides/{h}/{o}/{g}",
      tags: ["Catalog"],
      summary: "Rename a guide (editors; drafts only by their author or the executive chef)",
      security: bearer,
      middleware: [user] as const,
      request: { params: GuideParams, body: { required: true, content: json(Name) } },
      responses: { 204: { description: "Renamed." }, ...errors },
    }),
    async (c) => {
      const { h, o, g } = c.req.valid("param");
      await change(c.var.claims, h, o, g, "rename_guide", c.req.valid("json").name);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/guides/{h}/{o}/{g}/publish",
      tags: ["Catalog"],
      summary: "Publish a draft guide (needs both validated files)",
      security: bearer,
      middleware: [user] as const,
      request: { params: GuideParams },
      responses: { 204: { description: "Published." }, ...errors },
    }),
    async (c) => {
      const { h, o, g } = c.req.valid("param");
      await change(c.var.claims, h, o, g, "publish");
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/v1/guides/{h}/{o}/{g}",
      tags: ["Catalog"],
      summary: "Remove a guide from the portal (executive chef)",
      security: bearer,
      middleware: [user] as const,
      request: { params: GuideParams },
      responses: { 204: { description: "Removed." }, ...errors },
    }),
    async (c) => {
      const { h, o, g } = c.req.valid("param");
      await change(c.var.claims, h, o, g, "delete_guide");
      return c.body(null, 204);
    },
  );
}
