import { createRoute, z } from "@hono/zod-openapi";
import { asUser, type Claims } from "../db/client.js";
import { requireUser } from "../http/auth.js";
import { ErrorSchema } from "../http/errors.js";
import type { App, Deps } from "../http/types.js";
import { type Json, mailChange, mailRead } from "../queries/mail.queries.js";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const error = (description: string) => ({ description, content: json(ErrorSchema) });
const bearer = [{ bearer: [] }];
const hotel = z.string().regex(/^[a-z0-9-]{1,200}$/).openapi({ param: { name: "h", in: "path" }, description: "Hotel key" });
const uuid = z.uuid();

const Entry = z.object({
  id: z.uuid(),
  origin: z.enum(["inbox", "sent", "drafts"]),
  folder: z.uuid().nullable(),
  starred: z.boolean(),
  unread: z.boolean(),
  sender: z.string(),
  recipients: z.string(),
  subject: z.string(),
  updated_at: z.string(),
  snippet: z.string().nullable(),
});
const Mailbox = z
  .object({
    address: z.string(),
    folders: z.array(z.object({ id: z.uuid(), label: z.string() })),
    entries: z.array(Entry).openapi({ description: "Up to 41 entries: 40 per page plus one to tell whether a next page exists." }),
    item: Entry.omit({ snippet: true }).extend({ body: z.string(), revision: z.number().int() }).nullable(),
  })
  .openapi("Mailbox");

const Saved = z
  .object({ id: z.uuid(), revision: z.number().int().optional(), sent: z.boolean().default(false) })
  .openapi("MailSaved");

const errors = { 401: error("Session ended."), 403: error("No mailbox in this hotel."), 404: error("Folder or message not found."), 409: error("Changed elsewhere (e.g. another tab)."), 422: error("Not valid (the detail explains).") };

export function mailRoutes(app: App, deps: Deps) {
  const user = requireUser(deps.auth.verifyToken);
  const change = async (claims: Claims, h: string, op: string, data: Record<string, unknown>) =>
    (await asUser(deps.pool, claims, (tx) => mailChange.run({ h, op, data: data as Json }, tx)))[0]?.result as Record<string, unknown>;

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/hotels/{h}/mail",
      tags: ["Mail"],
      summary: "A mailbox page, optionally with one message",
      security: bearer,
      middleware: [user] as const,
      request: {
        params: z.object({ h: hotel }),
        query: z.object({
          box: z.union([z.enum(["inbox", "sent", "drafts", "starred"]), uuid]).default("inbox").openapi({ description: "Base box or personal folder id." }),
          page: z.coerce.number().int().min(0).max(1_000_000).default(0),
          item: uuid.optional(),
        }),
      },
      responses: { 200: { description: "The mailbox.", content: json(Mailbox) }, ...errors },
    }),
    async (c) => {
      const { box, page, item } = c.req.valid("query");
      const [row] = await asUser(deps.pool, c.var.claims, (tx) => mailRead.run({ h: c.req.valid("param").h, box, page, item: item ?? null }, tx));
      return c.json(Mailbox.parse(row?.mail), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/hotels/{h}/mail/folders",
      tags: ["Mail"],
      summary: "Create a personal folder",
      security: bearer,
      middleware: [user] as const,
      request: { params: z.object({ h: hotel }), body: { required: true, content: json(z.object({ label: z.string().max(200) })) } },
      responses: { 200: { description: "Created.", content: json(z.object({ id: z.uuid() })) }, ...errors },
    }),
    async (c) => {
      const result = await change(c.var.claims, c.req.valid("param").h, "folder_create", c.req.valid("json"));
      return c.json(z.object({ id: z.uuid() }).parse(result), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/v1/hotels/{h}/mail/folders/{folder}",
      tags: ["Mail"],
      summary: "Delete a personal folder (its messages return to their box)",
      security: bearer,
      middleware: [user] as const,
      request: { params: z.object({ h: hotel, folder: uuid.openapi({ param: { name: "folder", in: "path" } }) }) },
      responses: { 204: { description: "Deleted." }, ...errors },
    }),
    async (c) => {
      const { h, folder } = c.req.valid("param");
      await change(c.var.claims, h, "folder_delete", { folder });
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/v1/hotels/{h}/mail/messages/{id}",
      tags: ["Mail"],
      summary: "Save a draft, or send it",
      description: "The client picks the id of a new draft. `revision` must match the stored draft (0 for a new one).",
      security: bearer,
      middleware: [user] as const,
      request: {
        params: z.object({ h: hotel, id: uuid.openapi({ param: { name: "id", in: "path" } }) }),
        body: {
          required: true,
          content: json(
            z.object({
              to: z.string().max(1500),
              subject: z.string().max(200),
              body: z.string().max(30000),
              revision: z.number().int().min(0),
              send: z.boolean().default(false),
            }),
          ),
        },
      },
      responses: {
        200: { description: "Saved or sent.", content: json(Saved) },
        ...errors,
      },
    }),
    async (c) => {
      const { h, id } = c.req.valid("param");
      const { send, ...data } = c.req.valid("json");
      const result = await change(c.var.claims, h, send ? "send" : "save", { ...data, id });
      return c.json(Saved.parse(result), 200);
    },
  );

  const Action = z.discriminatedUnion("action", [
    z.object({ action: z.literal("star"), value: z.boolean() }),
    z.object({ action: z.literal("read") }),
    z.object({ action: z.literal("move"), folder: uuid.nullable() }),
  ]);
  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/hotels/{h}/mail/messages/{id}/actions",
      tags: ["Mail"],
      summary: "Star, mark as read, or move a message",
      security: bearer,
      middleware: [user] as const,
      request: {
        params: z.object({ h: hotel, id: uuid.openapi({ param: { name: "id", in: "path" } }) }),
        body: { required: true, content: json(Action) },
      },
      responses: { 204: { description: "Done." }, ...errors },
    }),
    async (c) => {
      const { h, id } = c.req.valid("param");
      const { action, ...rest } = c.req.valid("json");
      await change(c.var.claims, h, action, { ...rest, id });
      return c.body(null, 204);
    },
  );
}
