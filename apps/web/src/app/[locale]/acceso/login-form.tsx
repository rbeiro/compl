"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState } from "react";
import { signIn, type SignInState } from "@/app/actions/auth";
import { Button } from "@/components/button";
import { Icon } from "@/components/icon";

const errorKeys = {
  credentials: "errorCredentials",
  rateLimit: "errorRateLimit",
  network: "errorNetwork",
} as const;

const inputClass =
  "min-h-target w-full rounded-control border border-line-strong bg-surface ps-11 pe-4 focus-visible:outline-primary";

export function LoginForm() {
  const t = useTranslations("Login");
  const c = useTranslations("Common");
  const locale = useLocale();
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, {});

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="locale" value={locale} />
      <label className="block space-y-2">
        <span className="text-sm font-semibold">{t("email")}</span>
        <span className="relative block">
          <Icon name="mail" className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-muted" />
          <input name="email" type="email" autoComplete="username" required className={inputClass} />
        </span>
      </label>
      <label className="block space-y-2">
        <span className="text-sm font-semibold">{t("password")}</span>
        <span className="relative block">
          <Icon name="lock" className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-muted" />
          <input name="password" type="password" autoComplete="current-password" required className={inputClass} />
        </span>
      </label>
      <Button type="submit" disabled={pending} className="w-full">
        {c("enterPortal")} <Icon name="arrow" />
      </Button>
      <p role="alert" className="min-h-6 text-sm font-medium text-error">
        {state.error ? t(errorKeys[state.error]) : null}
      </p>
    </form>
  );
}
