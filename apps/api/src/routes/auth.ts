import { createRoute, z } from "@hono/zod-openapi";
import { AuthProviderError } from "../auth/provider.js";
import { asService, asUser, type Claims } from "../db/client.js";
import { secondFactorEmail, toLocale } from "../email/templates.js";
import { requireUser } from "../http/auth.js";
import { ApiError, ErrorSchema } from "../http/errors.js";
import { limitPublicRequest } from "../http/rate-limit.js";
import type { App, Deps } from "../http/types.js";
import { needsMfa } from "../queries/access.queries.js";
import {
  activateAccess,
  beginAccept,
  beginRecovery,
  finishPasswordChange,
  issueSecondFactor,
  personalBackup,
  releaseRecovery,
  verifySecondFactor,
} from "../queries/auth.queries.js";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const error = (description: string) => ({ description, content: json(ErrorSchema) });
const bearer = [{ bearer: [] }];

const Locale = z.enum(["es", "en", "ca", "it", "pt", "fr", "ar"]).default("es").openapi({ description: "Language of emails sent." });
const Email = z.string().trim().toLowerCase().max(254).pipe(z.email());

const Tokens = z
  .object({
    accessToken: z.string(),
    refreshToken: z.string(),
    expiresAt: z.number().int().openapi({ description: "Unix time (s) when the access token expires." }),
  })
  .openapi("Tokens");

/** What the client must show next. */
const Next = z.enum(["second_factor", "password_change", "workspace"]).openapi("NextStep");

const SignInResult = z
  .object({
    tokens: Tokens,
    next: Next,
    codeSent: z.boolean().openapi({ description: "Whether a two-step code was emailed (next = second_factor)." }),
  })
  .openapi("SignInResult");

function providerError(e: unknown): never {
  if (!(e instanceof AuthProviderError)) throw e;
  switch (e.kind) {
    case "invalid_credentials":
      throw new ApiError(401, "invalid_credentials", "Check your email address and password.");
    case "invalid_refresh_token":
      throw new ApiError(401, "session_expired", "Sign in again.");
    case "weak_password":
      throw new ApiError(422, "weak_password", "Choose a longer password.");
    case "user_exists":
      throw new ApiError(409, "conflict", "The account already exists.");
    case "rate_limited":
      throw new ApiError(429, "rate_limited", "Too many attempts. Wait a moment and try again.");
    default:
      throw new ApiError(503, "unavailable", "The sign-in service is not available. Try again.");
  }
}

export function authRoutes(app: App, deps: Deps) {
  const { pool, auth, mailer } = deps;
  const user = requireUser(auth.verifyToken);

  /** Decides the next step for a session; opens the workspace when nothing is pending. */
  async function nextStep(claims: Claims): Promise<z.infer<typeof Next>> {
    const [mfa] = await asUser(pool, claims, (tx) => needsMfa.run(undefined, tx));
    if (mfa?.needsMfa) return "second_factor";
    const appMeta = (claims.app_metadata ?? {}) as Record<string, unknown>;
    if (appMeta.compi_must_change === "true") return "password_change";
    await asUser(pool, claims, (tx) => activateAccess.run(undefined, tx));
    return "workspace";
  }

  /** Issues and emails a two-step code; the code itself never leaves the server otherwise. */
  async function sendSecondFactor(claims: Claims, locale: z.infer<typeof Locale>) {
    const [row] = await asService(pool, claims, (tx) => issueSecondFactor.run(undefined, tx));
    if (!row) throw new ApiError(500, "internal_error", "Unexpected error.");
    await mailer.send(secondFactorEmail(row.email, row.code, toLocale(locale)));
  }

  async function startSession(tokens: { accessToken: string }, locale: z.infer<typeof Locale>) {
    const claims = await auth.verifyToken(tokens.accessToken);
    const next = await nextStep(claims);
    let codeSent = false;
    if (next === "second_factor") {
      try {
        await sendSecondFactor(claims, locale);
        codeSent = true;
      } catch (e) {
        // The user can ask for a new code from the verification screen.
        console.error("second factor email failed", e);
      }
    }
    return { next, codeSent };
  }

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/auth/sign-in",
      tags: ["Auth"],
      summary: "Sign in with email and password",
      description: "Returns the session tokens and the next step. When two-step verification is required, a code is emailed.",
      request: { body: { required: true, content: json(z.object({ email: Email, password: z.string().min(1).max(128), locale: Locale })) } },
      responses: {
        200: { description: "Signed in.", content: json(SignInResult) },
        401: error("Wrong email or password."),
        429: error("Too many attempts."),
        503: error("Auth service unavailable."),
      },
    }),
    async (c) => {
      const { email, password, locale } = c.req.valid("json");
      const tokens = await auth.signInWithPassword(email, password).catch(providerError);
      return c.json({ tokens, ...(await startSession(tokens, locale)) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/auth/refresh",
      tags: ["Auth"],
      summary: "Exchange a refresh token for new tokens",
      request: { body: { required: true, content: json(z.object({ refreshToken: z.string().min(1).max(512) })) } },
      responses: { 200: { description: "New tokens.", content: json(Tokens) }, 401: error("Session ended.") },
    }),
    async (c) => {
      const tokens = await auth.refresh(c.req.valid("json").refreshToken).catch(providerError);
      return c.json(tokens, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/auth/sign-out",
      tags: ["Auth"],
      summary: "End the current session",
      security: bearer,
      middleware: [user] as const,
      responses: { 204: { description: "Signed out." }, 401: error("Not signed in.") },
    }),
    async (c) => {
      await auth.signOut(c.var.accessToken).catch(providerError);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/auth/second-factor",
      tags: ["Auth"],
      summary: "Email a new two-step code",
      security: bearer,
      middleware: [user] as const,
      request: { body: { required: true, content: json(z.object({ locale: Locale })) } },
      responses: {
        202: { description: "Code sent." },
        401: error("Session ended."),
        409: error("This session does not need verification."),
        429: error("Wait before asking for another code."),
      },
    }),
    async (c) => {
      await sendSecondFactor(c.var.claims, c.req.valid("json").locale);
      return c.body(null, 202);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/auth/second-factor/verify",
      tags: ["Auth"],
      summary: "Check a two-step code",
      security: bearer,
      middleware: [user] as const,
      request: { body: { required: true, content: json(z.object({ code: z.string().trim().regex(/^\d{6}$/) })) } },
      responses: {
        200: {
          description: "Result. `invalid`: wrong code; `expired`: ask for a new one; `locked`: too many wrong codes, ask for a new one.",
          content: json(z.object({ status: z.enum(["verified", "invalid", "expired", "locked"]), next: Next.nullable() })),
        },
        401: error("Session ended."),
      },
    }),
    async (c) => {
      const claims = c.var.claims;
      const [row] = await asUser(pool, claims, (tx) => verifySecondFactor.run({ code: c.req.valid("json").code }, tx));
      const status = z.enum(["verified", "invalid", "expired", "locked"]).parse(row?.status);
      return c.json({ status, next: status === "verified" ? await nextStep(claims) : null }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/auth/password",
      tags: ["Auth"],
      summary: "Replace a temporary password",
      description: "For accounts created with a temporary password. Returns fresh tokens without the pending-change mark.",
      security: bearer,
      middleware: [user] as const,
      request: { body: { required: true, content: json(z.object({ password: z.string().min(10).max(128), locale: Locale })) } },
      responses: {
        200: { description: "Password changed.", content: json(SignInResult) },
        401: error("Session ended."),
        422: error("Choose another password (10+ characters, different from the temporary one)."),
      },
    }),
    async (c) => {
      const { password, locale } = c.req.valid("json");
      const claims = c.var.claims;
      const email = typeof claims.email === "string" ? claims.email : null;
      if (!email) throw new ApiError(401, "session_expired", "Sign in again.");
      await auth.admin.updateUser(claims.sub, { password }).catch(providerError);
      await asUser(pool, claims, (tx) => finishPasswordChange.run(undefined, tx));
      // A new session: the old token still carries the pending-change mark.
      const tokens = await auth.signInWithPassword(email, password).catch(providerError);
      await auth.signOut(c.var.accessToken).catch(() => {});
      return c.json({ tokens, ...(await startSession(tokens, locale)) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/auth/recover",
      tags: ["Auth"],
      summary: "Set a new password with a personal recovery code",
      request: {
        body: {
          required: true,
          content: json(
            z.object({ email: Email, code: z.string().max(80), password: z.string().min(8).max(128) }),
          ),
        },
      },
      responses: {
        204: { description: "Password changed; other sessions were ended." },
        403: error("Email or code not valid."),
        422: error("Choose another password."),
        429: error("Too many attempts."),
      },
    }),
    async (c) => {
      await limitPublicRequest(c, pool, deps.config.serverSecret, "recover");
      const { email, code, password } = c.req.valid("json");
      const normalized = code.replace(/[\s-]/g, "").toUpperCase();
      if (!/^[a-z0-9._+-]+@compichef[.]com$/.test(email) || !/^[0-9A-F]{40}$/.test(normalized)) {
        throw new ApiError(403, "forbidden", "Email or code not valid.");
      }
      const [begun] = await asService(pool, null, (tx) => beginRecovery.run({ address: email, code: normalized }, tx)).catch(
        (e: { code?: string }) => {
          if (e.code === "42501") throw new ApiError(403, "forbidden", "Email or code not valid.");
          throw e;
        },
      );
      const { uid, attempt } = z.object({ uid: z.uuid(), attempt: z.uuid() }).parse(begun?.result);
      try {
        // The auth.users trigger checks the lease and ends the user's sessions.
        await auth.admin.updateUser(uid, { password, appMetadata: { compi_recovery_attempt: attempt } });
      } catch (e) {
        await asService(pool, null, (tx) => releaseRecovery.run({ userId: uid, lease: attempt }, tx));
        providerError(e);
      }
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/auth/invitations/accept",
      tags: ["Auth"],
      summary: "Accept an invitation and set a password",
      request: {
        body: {
          required: true,
          content: json(
            z.object({ ticket: z.string().regex(/^v7_[a-f0-9]{64}$/), password: z.string().min(8).max(128) }),
          ),
        },
      },
      responses: {
        200: { description: "Account activated; sign in with the email and new password.", content: json(z.object({ email: z.string() })) },
        403: error("The link is wrong, expired or already used."),
        409: error("Activation already in progress."),
        422: error("Choose another password."),
        429: error("Too many attempts."),
      },
    }),
    async (c) => {
      await limitPublicRequest(c, pool, deps.config.serverSecret, "accept");
      const { ticket, password } = c.req.valid("json");
      const [begun] = await asService(pool, null, (tx) => beginAccept.run({ ticket }, tx)).catch((e: { code?: string }) => {
        if (e.code === "42501") throw new ApiError(403, "forbidden", "The link is wrong, expired or already used.");
        throw e;
      });
      const info = z
        .object({ attempt: z.uuid(), email: z.string(), employee: z.uuid(), legacy_id: z.uuid().nullable() })
        .parse(begun?.result);
      const appMetadata = { compi_lab_attempt: info.attempt, compi_lab_staff: info.employee };
      // The auth.users trigger links the confirmed account to the employee.
      if (info.legacy_id) {
        await auth.admin.updateUser(info.legacy_id, { password, emailConfirmed: true, appMetadata }).catch(providerError);
      } else {
        await auth.admin.createUser({ email: info.email, password, emailConfirmed: true, appMetadata }).catch(providerError);
      }
      return c.json({ email: info.email }, 200);
    },
  );

  const RecoveryCodeStatus = z.object({ configured: z.boolean() });

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/account/recovery-code",
      tags: ["Account"],
      summary: "Whether the user has a personal recovery code",
      security: bearer,
      middleware: [user] as const,
      responses: { 200: { description: "Status.", content: json(RecoveryCodeStatus) }, 401: error("Session ended.") },
    }),
    async (c) => {
      const [row] = await asUser(pool, c.var.claims, (tx) => personalBackup.run({ issue: false }, tx));
      return c.json(RecoveryCodeStatus.parse(row?.result), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/account/recovery-code",
      tags: ["Account"],
      summary: "Create or replace the personal recovery code",
      description: "The code is returned once and never stored in clear text. Replacing it invalidates the previous one.",
      security: bearer,
      middleware: [user] as const,
      responses: {
        200: { description: "The new code.", content: json(z.object({ code: z.string() })) },
        401: error("Session ended."),
        403: error("Sign in again with your password before creating a code."),
      },
    }),
    async (c) => {
      const [row] = await asUser(pool, c.var.claims, (tx) => personalBackup.run({ issue: true }, tx));
      return c.json(z.object({ code: z.string() }).parse(row?.result), 200);
    },
  );
}
