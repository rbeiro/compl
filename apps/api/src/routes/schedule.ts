import { createRoute, z } from "@hono/zod-openapi";
import { asUser } from "../db/client.js";
import { requireUser } from "../http/auth.js";
import { ErrorSchema } from "../http/errors.js";
import type { App, Deps } from "../http/types.js";
import { scheduleBalance, scheduleDecide, scheduleEdit, scheduleRequest, scheduleView } from "../queries/schedule.queries.js";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const error = (description: string) => ({ description, content: json(ErrorSchema) });
const bearer = [{ bearer: [] }];
const pathParam = (name: string) => ({ param: { name, in: "path" as const } });
const hotel = z.string().regex(/^[a-z0-9-]{1,200}$/).openapi({ ...pathParam("h"), description: "Hotel key" });
const isoDay = z.iso.date();
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).openapi({ example: "2026-12" });
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/).openapi({ example: "08:00" });
const uuid = z.uuid();

const Person = z.object({ id: uuid, name: z.string(), position: z.string(), rank: z.number().int(), department: z.string() });
const ScheduleView = z
  .object({
    me: uuid,
    admin: z.boolean(),
    dept: z.string().openapi({ description: "Department shown (lowercase key)." }),
    departments: z.array(z.object({ key: z.string(), name: z.string() })).nullable(),
    people: z.array(Person),
    shifts: z.array(
      z.object({
        employee: uuid,
        day: isoDay,
        kind: z.enum(["work", "off"]),
        starts: z.string().nullable(),
        ends: z.string().nullable(),
        revision: uuid,
      }),
    ),
    vacations: z.array(z.object({ employee: uuid, day: isoDay })),
    balances: z.array(
      Person.extend({ total: z.number().int(), adjustment: z.number().int(), revision: uuid.nullable() }).openapi({
        description: "Hours balance in minutes: `total` up to this month, `adjustment` set for this month.",
      }),
    ),
    mine: z.array(z.object({ id: uuid, days: z.array(isoDay), state: z.enum(["pending", "approved", "rejected"]) })),
    requests: z.array(
      z.object({
        id: uuid,
        name: z.string(),
        department: z.string(),
        days: z.array(isoDay),
        state: z.enum(["pending", "approved", "rejected"]),
      }),
    ),
  })
  .openapi("ScheduleView");

const errors = {
  401: error("Session ended."),
  403: error("Not allowed (only the executive chef edits; staff see their own department)."),
  409: error("Changed elsewhere, or conflicts with approved leave or an earlier request."),
  422: error("Not valid (the detail explains)."),
};
const noContent = { 204: { description: "Saved." }, ...errors };

export function scheduleRoutes(app: App, deps: Deps) {
  const user = requireUser(deps.auth.verifyToken);

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/hotels/{h}/schedule",
      tags: ["Schedules"],
      summary: "Roster, shifts, leave and hours balances of one month",
      security: bearer,
      middleware: [user] as const,
      request: {
        params: z.object({ h: hotel }),
        query: z.object({
          month,
          department: z.string().max(120).optional().openapi({ description: "Department name; defaults to the user's own." }),
        }),
      },
      responses: { 200: { description: "The month.", content: json(ScheduleView) }, ...errors },
    }),
    async (c) => {
      const { month: m, department } = c.req.valid("query");
      const [row] = await asUser(deps.pool, c.var.claims, (tx) =>
        scheduleView.run({ h: c.req.valid("param").h, monthStart: `${m}-01`, department: department ?? null }, tx),
      );
      return c.json(ScheduleView.parse(row?.view), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/v1/hotels/{h}/schedule/shifts/{employee}/{day}",
      tags: ["Schedules"],
      summary: "Set, mark as day off, or clear one shift (executive chef)",
      security: bearer,
      middleware: [user] as const,
      request: {
        params: z.object({ h: hotel, employee: uuid.openapi(pathParam("employee")), day: isoDay.openapi(pathParam("day")) }),
        body: {
          required: true,
          content: json(
            z.object({
              kind: z.enum(["work", "off", "clear"]),
              start: time.nullable().optional(),
              end: time.nullable().optional(),
              previous: uuid.nullable().optional().openapi({ description: "Revision of the shift being replaced." }),
            }),
          ),
        },
      },
      responses: noContent,
    }),
    async (c) => {
      const { h, employee, day } = c.req.valid("param");
      const { kind, start, end, previous } = c.req.valid("json");
      await asUser(deps.pool, c.var.claims, (tx) =>
        scheduleEdit.run({ h, employee, day, kind, startTime: start ?? null, endTime: end ?? null, previous: previous ?? null }, tx),
      );
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/v1/hotels/{h}/schedule/balances/{employee}/{month}",
      tags: ["Schedules"],
      summary: "Set the hours adjustment of one month (executive chef)",
      security: bearer,
      middleware: [user] as const,
      request: {
        params: z.object({ h: hotel, employee: uuid.openapi(pathParam("employee")), month: month.openapi(pathParam("month")) }),
        body: {
          required: true,
          content: json(
            z.object({
              minutes: z.number().int().min(-100_000).max(100_000),
              previous: uuid.nullable().optional(),
            }),
          ),
        },
      },
      responses: noContent,
    }),
    async (c) => {
      const { h, employee, month: m } = c.req.valid("param");
      const { minutes, previous } = c.req.valid("json");
      await asUser(deps.pool, c.var.claims, (tx) =>
        scheduleBalance.run({ h, employee, monthStart: `${m}-01`, minutes, previous: previous ?? null }, tx),
      );
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/v1/hotels/{h}/schedule/leave/{id}",
      tags: ["Schedules"],
      summary: "Request leave days (idempotent for the same id and days)",
      security: bearer,
      middleware: [user] as const,
      request: {
        params: z.object({ h: hotel, id: uuid.openapi(pathParam("id")) }),
        body: { required: true, content: json(z.object({ days: z.array(isoDay).min(1).max(366) })) },
      },
      responses: noContent,
    }),
    async (c) => {
      const { h, id } = c.req.valid("param");
      await asUser(deps.pool, c.var.claims, (tx) => scheduleRequest.run({ h, id, days: c.req.valid("json").days }, tx));
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/v1/hotels/{h}/schedule/leave/{id}/decision",
      tags: ["Schedules"],
      summary: "Approve or reject a leave request (executive chef)",
      security: bearer,
      middleware: [user] as const,
      request: {
        params: z.object({ h: hotel, id: uuid.openapi(pathParam("id")) }),
        body: { required: true, content: json(z.object({ decision: z.enum(["approved", "rejected"]) })) },
      },
      responses: noContent,
    }),
    async (c) => {
      const { h, id } = c.req.valid("param");
      await asUser(deps.pool, c.var.claims, (tx) => scheduleDecide.run({ h, id, decision: c.req.valid("json").decision }, tx));
      return c.body(null, 204);
    },
  );
}
