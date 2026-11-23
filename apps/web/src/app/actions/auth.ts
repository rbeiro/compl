"use server";

import { hasLocale } from "next-intl";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";

export type SignInState = { error?: "credentials" | "rateLimit" | "network" };

const credentials = z.object({
  email: z.email().trim(),
  password: z.string().min(1),
});

function localeFrom(formData: FormData) {
  const value = formData.get("locale");
  return hasLocale(routing.locales, value) ? value : routing.defaultLocale;
}

// Returns error codes, not text: Server Actions can't read the [locale]
// root param, so the client form translates them.
export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "credentials" };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    if (error.status === 429) return { error: "rateLimit" };
    if ([400, 401, 403, 422].includes(error.status ?? 0)) return { error: "credentials" };
    return { error: "network" };
  }

  // TODO(port): the legacy flow checks compi_needs_mfa (two-step verification)
  // and compi_must_change (temporary password) before opening the workspace.
  redirect({ href: "/portal", locale: localeFrom(formData) });
  return {};
}

export async function signOut(formData: FormData) {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect({ href: "/acceso", locale: localeFrom(formData) });
}
