"use server";

import { hasLocale } from "next-intl";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { apiWithToken, getApi, nextStepPath, type NextStep } from "@/lib/api";
import { accessToken, clearSession, saveSession } from "@/lib/session";

// Server Actions can't read the [locale] root param: forms send it, and the
// actions return error codes that the client components translate.

function localeFrom(formData: FormData) {
  const value = formData.get("locale");
  return hasLocale(routing.locales, value) ? value : routing.defaultLocale;
}

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "");

function goTo(next: NextStep, formData: FormData): never {
  return redirect({ href: nextStepPath[next], locale: localeFrom(formData) });
}

// ---------------------------------------------------------------- sign-in

export type SignInState = { error?: "credentials" | "rateLimit" | "network" };

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = z
    .object({ email: z.email().trim(), password: z.string().min(1) })
    .safeParse({ email: text(formData, "email"), password: text(formData, "password") });
  if (!parsed.success) return { error: "credentials" };

  const { data, response } = await apiWithToken()
    .POST("/v1/auth/sign-in", { body: { ...parsed.data, locale: localeFrom(formData) } })
    .catch(() => ({ data: undefined, response: undefined }));
  if (!data) {
    if (response?.status === 401) return { error: "credentials" };
    if (response?.status === 429) return { error: "rateLimit" };
    return { error: "network" };
  }
  await saveSession(data.tokens);
  goTo(data.next, formData);
}

export async function signOut(formData: FormData) {
  const token = await accessToken();
  if (token) await apiWithToken(token).POST("/v1/auth/sign-out").catch(() => {});
  await clearSession();
  redirect({ href: "/acceso", locale: localeFrom(formData) });
}

// ---------------------------------------------------------------- two-step code

export type VerifyState = { error?: "invalid" | "expired" | "locked" | "failed"; resent?: boolean; wait?: boolean };

export async function verifyCode(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const api = await getApi();
  if (!api) redirect({ href: "/acceso", locale: localeFrom(formData) });
  // Arabic keyboards type Arabic-Indic digits; the code is ASCII.
  const code = text(formData, "code")
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .trim();
  if (!/^\d{6}$/.test(code)) return { error: "invalid" };
  const { data } = await api!.POST("/v1/auth/second-factor/verify", { body: { code } }).catch(() => ({ data: undefined }));
  if (!data) return { error: "failed" };
  if (data.status !== "verified" || !data.next) return { error: data.status === "verified" ? "failed" : data.status };
  goTo(data.next, formData);
}

export async function resendCode(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const api = await getApi();
  if (!api) redirect({ href: "/acceso", locale: localeFrom(formData) });
  const { response } = await api!
    .POST("/v1/auth/second-factor", { body: { locale: localeFrom(formData) } })
    .catch(() => ({ response: undefined }));
  if (response?.status === 202) return { resent: true };
  if (response?.status === 429) return { wait: true };
  return { error: "failed" };
}

// ---------------------------------------------------------------- temporary password

export type PasswordState = { error?: "mismatch" | "weak" | "failed" };

export async function changePassword(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  const password = text(formData, "password");
  if (password !== text(formData, "repeat")) return { error: "mismatch" };
  if (password.length < 10) return { error: "weak" };
  const api = await getApi();
  if (!api) redirect({ href: "/acceso", locale: localeFrom(formData) });
  const { data, response } = await api!
    .POST("/v1/auth/password", { body: { password, locale: localeFrom(formData) } })
    .catch(() => ({ data: undefined, response: undefined }));
  if (!data) return { error: response?.status === 422 ? "weak" : "failed" };
  await saveSession(data.tokens);
  goTo(data.next, formData);
}

// ---------------------------------------------------------------- recovery

export type RecoverState = { error?: "mismatch" | "weak" | "invalid" | "failed" | "wait"; done?: boolean };

export async function recoverPassword(_prev: RecoverState, formData: FormData): Promise<RecoverState> {
  const password = text(formData, "password");
  if (password !== text(formData, "repeat")) return { error: "mismatch" };
  const { response } = await apiWithToken()
    .POST("/v1/auth/recover", {
      body: { email: text(formData, "email").trim(), code: text(formData, "code"), password },
    })
    .catch(() => ({ response: undefined }));
  if (response?.status === 204) return { done: true };
  if (response?.status === 422) return { error: password.length < 8 ? "weak" : "invalid" };
  if (response?.status === 403) return { error: "invalid" };
  if (response?.status === 429) return { error: "wait" };
  return { error: "failed" };
}

// ---------------------------------------------------------------- invitations

export type InvitationState = {
  error?: "mismatch" | "weak" | "failed" | "interrupted" | "wait";
  /** The link can no longer be used: hide the form. */
  unavailable?: "expired" | "activated";
};

export async function acceptInvitation(_prev: InvitationState, formData: FormData): Promise<InvitationState> {
  const ticket = text(formData, "ticket");
  const password = text(formData, "password");
  if (password !== text(formData, "repeat")) return { error: "mismatch" };
  if (!/^v7_[a-f0-9]{64}$/.test(ticket)) return { unavailable: "expired" };
  const api = apiWithToken();
  const accepted = await api
    .POST("/v1/auth/invitations/accept", { body: { ticket, password } })
    .catch(() => null);
  if (!accepted) return { error: "interrupted" };
  if (!accepted.data) {
    const status = accepted.response.status;
    if (status === 403) return { unavailable: "expired" };
    if (status === 422 || status === 400) return { error: "weak" };
    if (status === 429) return { error: "wait" };
    return { error: "failed" };
  }
  // Sign in straight away, then offer the recovery code (legacy behavior).
  const signed = await api
    .POST("/v1/auth/sign-in", { body: { email: accepted.data.email, password, locale: localeFrom(formData) } })
    .catch(() => null);
  if (!signed?.data) return { unavailable: "activated" };
  await saveSession(signed.data.tokens);
  if (signed.data.next !== "workspace") goTo(signed.data.next, formData);
  redirect({ href: "/seguridad", locale: localeFrom(formData) });
  return {};
}

// ---------------------------------------------------------------- recovery code

export type RecoveryCodeState = { code?: string; error?: "reauth" | "failed" };

export async function issueRecoveryCode(): Promise<RecoveryCodeState> {
  const api = await getApi();
  if (!api) return { error: "reauth" };
  const { data, response } = await api.POST("/v1/account/recovery-code").catch(() => ({ data: undefined, response: undefined }));
  if (data) return { code: data.code };
  return { error: response?.status === 403 || response?.status === 401 ? "reauth" : "failed" };
}
