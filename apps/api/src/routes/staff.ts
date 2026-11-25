import { createHash, createHmac, randomInt } from "node:crypto";
import { createRoute, z } from "@hono/zod-openapi";
import { AuthProviderError } from "../auth/provider.js";
import { asService, asUser, type Claims } from "../db/client.js";
import { invitationEmail, toLocale } from "../email/templates.js";
import { requireUser } from "../http/auth.js";
import { ApiError, ErrorSchema } from "../http/errors.js";
import type { App, Deps } from "../http/types.js";
import { listMyHotels } from "../queries/access.queries.js";
import {
  changeRank,
  createdAccountTarget,
  deleteWithdrawnEmployee,
  invitationRevision,
  linkCreatedAccount,
  listStaff,
  manageInvitation,
  provisionInvitationChannel,
  registerEmployee,
  relayInvitation,
  removePendingEmployee,
  setStaffAccess,
} from "../queries/staff.queries.js";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const error = (description: string) => ({ description, content: json(ErrorSchema) });
const bearer = [{ bearer: [] }];
const pathParam = (name: string) => ({ param: { name, in: "path" as const } });
const hotel = z.string().regex(/^[a-z0-9-]{1,200}$/).openapi({ ...pathParam("h"), description: "Hotel key" });
const employee = z.uuid().openapi(pathParam("id"));
const rank = z.number().int().min(1).max(3);

const StaffMember = z
  .object({
    id: z.uuid(),
    email: z.string(),
    name: z.string(),
    position: z.string(),
    outlet: z.string(),
    rank,
    hasAccount: z.boolean(),
    withdrawnAt: z.string().nullable().openapi({ description: "Set while access is withdrawn." }),
    inviteState: z.enum(["prepared", "queued", "delivered", "issued", "accepted", "cancelled"]).nullable(),
    inviteUntil: z.string().nullable(),
    inviteRevision: z.uuid().nullable(),
  })
  .openapi("StaffMember");

const errors = {
  401: error("Session ended."),
  403: error("Only the executive chef (rank 1) of the hotel manages its team."),
  404: error("Employee not found in this hotel."),
  409: error("Changed elsewhere, or would leave the hotel without an administrator."),
  422: error("Not valid (the detail explains)."),
  429: error("Too many accounts created recently."),
};

// Legacy compi-arts-crear-cuenta: 16 characters from an unambiguous alphabet,
// with an uppercase letter, a lowercase letter and a digit.
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
export function generatePassword(): string {
  for (;;) {
    const out = Array.from({ length: 16 }, () => alphabet[randomInt(alphabet.length)]).join("");
    if (/[A-Z]/.test(out) && /[a-z]/.test(out) && /[2-9]/.test(out)) return out;
  }
}

const iso = (value: Date | string | null) => (value == null ? null : value instanceof Date ? value.toISOString() : value);

export function staffRoutes(app: App, deps: Deps) {
  const { pool, auth, mailer, config } = deps;
  const user = requireUser(auth.verifyToken);

  async function requireAdmin(claims: Claims, h: string) {
    const hotels = await asUser(pool, claims, (tx) => listMyHotels.run(undefined, tx));
    if (!hotels.some((row) => row.hotelKey === h && row.accessRank === 1)) {
      throw new ApiError(403, "forbidden", "You do not have access to this resource.");
    }
  }

  /** Proof the API presents to deliver an employee's invitation; only its hash is stored. */
  const invitationProof = (id: string) => createHmac("sha256", config.serverSecret).update(`compi-invitation:${id}`).digest("hex");

  /**
   * Sends a queued invitation through the mailer: leases the message prepared
   * by compi_manage_invitation, reads the one-time ticket from it, emails our
   * own localized link, then confirms delivery. A failed send stays queued.
   */
  async function deliverInvitation(id: string, email: string, locale: string) {
    const proof = invitationProof(id);
    const [lease] = await asService(pool, null, (tx) => relayInvitation.run({ email, proof, receipt: null }, tx));
    const leased = lease?.result as { receipt?: string; message?: string } | undefined;
    if (!leased?.receipt || !leased.message) return false;
    const encoded = leased.message.split("\r\n\r\n").slice(1).join("").replace(/\s+/g, "");
    const ticket = /#(v7_[0-9a-f]+)/.exec(Buffer.from(encoded, "base64").toString("utf8"))?.[1];
    if (!ticket) return false;
    const lang = toLocale(locale);
    const link = `${config.appUrl}${lang === "es" ? "" : `/${lang}`}/invitacion#${ticket}`;
    await mailer.send({ ...invitationEmail(email, link, lang), idempotencyKey: `invitation-${leased.receipt}` });
    await asService(pool, null, (tx) => relayInvitation.run({ email, proof, receipt: leased.receipt }, tx));
    return true;
  }

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/hotels/{h}/staff",
      tags: ["Team"],
      summary: "The hotel's employees (executive chef)",
      security: bearer,
      middleware: [user] as const,
      request: { params: z.object({ h: hotel }) },
      responses: { 200: { description: "Employees by name.", content: json(z.object({ items: z.array(StaffMember) })) }, ...errors },
    }),
    async (c) => {
      const { h } = c.req.valid("param");
      await requireAdmin(c.var.claims, h);
      const rows = await asUser(pool, c.var.claims, (tx) => listStaff.run({ h }, tx));
      const items = rows.map((r) => ({ ...r, withdrawnAt: iso(r.withdrawnAt), inviteUntil: iso(r.inviteUntil) }));
      return c.json({ items: z.array(StaffMember).parse(items) }, 200);
    },
  );

  const Created = z
    .object({ email: z.string(), password: z.string(), mustChange: z.literal(true) })
    .openapi("CreatedAccount", { description: "The temporary password is returned once and never stored." });
  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/hotels/{h}/staff",
      tags: ["Team"],
      summary: "Register an employee and create their account",
      description:
        "CompI allocates a personal @compichef.com address (initial, surname, hotel code) and creates the login with a temporary password that must be changed at first sign-in. `requestId` makes retries safe: the same request returns the same address, and a second account is never created (409 `already_created`).",
      security: bearer,
      middleware: [user] as const,
      request: {
        params: z.object({ h: hotel }),
        body: {
          required: true,
          content: json(
            z.object({
              requestId: z.uuid(),
              givenName: z.string().trim().min(1).max(60),
              surname: z.string().trim().min(1).max(60),
              position: z.string().trim().min(1).max(120),
              outlet: z.string().trim().min(1).max(120),
              rank: z.union([z.literal(2), z.literal(3)]),
            }),
          ),
        },
      },
      responses: { 201: { description: "Account created.", content: json(Created) }, ...errors },
    }),
    async (c) => {
      const { h } = c.req.valid("param");
      const body = c.req.valid("json");
      const claims = c.var.claims;
      const [registered] = await asUser(pool, claims, (tx) =>
        registerEmployee.run(
          { h, requestId: body.requestId, givenName: body.givenName, surname: body.surname, position: body.position, outlet: body.outlet, rank: body.rank },
          tx,
        ),
      );
      const email = registered?.email;
      if (!email || !/^[a-z0-9._+-]+@compichef\.com$/.test(email)) throw new ApiError(503, "unavailable", "Try again later.");
      const [target] = await asService(pool, null, (tx) => createdAccountTarget.run({ id: body.requestId }, tx));
      if (!target || target.email !== email || target.hotelKey !== h) throw new ApiError(503, "unavailable", "Try again later.");
      if (target.userId || target.inviteState !== "prepared") {
        throw new ApiError(409, "already_created", "This account was already created; its password cannot be shown again.");
      }

      const password = generatePassword();
      let uid: string;
      try {
        uid = (await auth.admin.createUser({ email, password, emailConfirmed: true })).id;
      } catch (e) {
        if (e instanceof AuthProviderError && e.kind === "user_exists") throw new ApiError(409, "conflict", "The request conflicts with the current state.");
        throw new ApiError(503, "unavailable", "Try again later.");
      }
      try {
        await asService(pool, null, (tx) => linkCreatedAccount.run({ employee: body.requestId, uid, creator: claims.sub }, tx));
      } catch (e) {
        await auth.admin.deleteUser(uid).catch(() => {}); // no orphan logins
        throw e;
      }
      return c.json({ email, password, mustChange: true as const }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/v1/hotels/{h}/staff/{id}/rank",
      tags: ["Team"],
      summary: "Change an employee's rank",
      security: bearer,
      middleware: [user] as const,
      request: {
        params: z.object({ h: hotel, id: employee }),
        body: { required: true, content: json(z.object({ rank, previous: rank })) },
      },
      responses: { 204: { description: "Saved." }, ...errors },
    }),
    async (c) => {
      const { h, id } = c.req.valid("param");
      const { rank: next, previous } = c.req.valid("json");
      await asUser(pool, c.var.claims, (tx) => changeRank.run({ h, id, rank: next, previous }, tx));
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/v1/hotels/{h}/staff/{id}/access",
      tags: ["Team"],
      summary: "Withdraw or restore an employee's access",
      security: bearer,
      middleware: [user] as const,
      request: {
        params: z.object({ h: hotel, id: employee }),
        body: { required: true, content: json(z.object({ enabled: z.boolean(), expectedRank: rank })) },
      },
      responses: { 204: { description: "Saved." }, ...errors },
    }),
    async (c) => {
      const { h, id } = c.req.valid("param");
      const { enabled, expectedRank } = c.req.valid("json");
      await asUser(pool, c.var.claims, (tx) => setStaffAccess.run({ h, id, enabled, expectedRank }, tx));
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/v1/hotels/{h}/staff/{id}",
      tags: ["Team"],
      summary: "Delete an employee",
      description:
        "With `withdrawnAt` (the value from the list): deletes an employee whose access is withdrawn, with their mailbox, and their login if they belong to no other hotel. Without it: deletes a registration that never got an account.",
      security: bearer,
      middleware: [user] as const,
      request: {
        params: z.object({ h: hotel, id: employee }),
        query: z.object({ withdrawnAt: z.iso.datetime({ offset: true }).optional() }),
      },
      responses: { 204: { description: "Deleted." }, ...errors },
    }),
    async (c) => {
      const { h, id } = c.req.valid("param");
      const { withdrawnAt } = c.req.valid("query");
      await asUser(pool, c.var.claims, async (tx) => {
        if (withdrawnAt) await deleteWithdrawnEmployee.run({ h, id, withdrawal: withdrawnAt }, tx);
        else await removePendingEmployee.run({ h, id }, tx);
      });
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/hotels/{h}/staff/{id}/invitation",
      tags: ["Team"],
      summary: "Send, resend or cancel an employee's invitation",
      description:
        "For employees without an account. The invitation link (one use, one hour) is emailed to the employee's address; `previous` is the `inviteRevision` from the list.",
      security: bearer,
      middleware: [user] as const,
      request: {
        params: z.object({ h: hotel, id: employee }),
        body: {
          required: true,
          content: json(
            z.object({
              op: z.enum(["send", "replace", "cancel"]),
              previous: z.uuid().nullable(),
              locale: z.string().optional().openapi({ description: "Language of the email (default es)." }),
            }),
          ),
        },
      },
      responses: {
        200: {
          description: "Resulting state.",
          content: json(z.object({ state: z.enum(["queued", "delivered", "cancelled"]) })),
        },
        ...errors,
      },
    }),
    async (c) => {
      const { h, id } = c.req.valid("param");
      const { op, locale } = c.req.valid("json");
      let { previous } = c.req.valid("json");
      const claims = c.var.claims;
      const call = (operation: string) =>
        asUser(pool, claims, (tx) => manageInvitation.run({ h, id, op: operation, previous }, tx)).then(
          ([row]) => (row?.result ?? {}) as { state?: string },
        );
      let result = await call(op);
      if (result.state === "channel_required") {
        // The caller is rank 1 and the employee is pending (checked above):
        // open the delivery channel with a server-held proof, then queue again.
        const members = await asUser(pool, claims, (tx) => listStaff.run({ h }, tx));
        const member = members.find((m) => m.id === id);
        if (!member) throw new ApiError(404, "not_found", "Not found.");
        const proofHash = createHash("sha256").update(invitationProof(id), "utf8").digest("hex");
        await asService(pool, null, async (tx) => {
          await provisionInvitationChannel.run({ h, id, email: member.email, proofHash }, tx);
          previous = (await invitationRevision.run({ id }, tx))[0]?.revision ?? null;
        });
        result = await call("send");
      }
      if (result.state === "cancelled") return c.json({ state: "cancelled" as const }, 200);
      if (result.state !== "queued") throw new ApiError(409, "conflict", "The request conflicts with the current state.");
      const [row] = (await asUser(pool, claims, (tx) => listStaff.run({ h }, tx))).filter((m) => m.id === id);
      const delivered = row ? await deliverInvitation(id, row.email, locale ?? "es").catch((e) => (console.error(e), false)) : false;
      return c.json({ state: delivered ? ("delivered" as const) : ("queued" as const) }, 200);
    },
  );
}
