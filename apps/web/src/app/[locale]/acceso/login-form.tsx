"use client";

import { useLocale, useTranslations } from "next-intl";
import { startTransition, useActionState, useEffect, useRef, useSyncExternalStore } from "react";
import { signIn, type SignInState } from "@/app/actions/auth";
import { Icon } from "@/components/icon";
import { carbon } from "@/lib/motion";

const errorKeys = {
  credentials: "errorCredentials",
  rateLimit: "errorRateLimit",
  network: "errorNetwork",
} as const;

// Port of the legacy `#login` form (index.html auth template + portal.js).
export function LoginForm() {
  const t = useTranslations("Login");
  const c = useTranslations("Common");
  const locale = useLocale();
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, {});
  const errorRef = useRef<HTMLParagraphElement>(null);
  // Like the legacy form, the button stays disabled until the page is interactive.
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);

  // "login-feedback" motion whenever a new error appears.
  useEffect(() => {
    if (state.error) carbon(errorRef.current);
  }, [state]);

  return (
    <form
      method="post"
      // Submitted manually (not via `action={...}`) so React does not reset the
      // fields after a failed attempt; the legacy form kept what was typed.
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => action(data));
      }}
      // Same motion on the first invalid field when native validation blocks submit.
      onInvalidCapture={(event) => {
        const form = event.currentTarget;
        if (event.target === form.querySelector(":invalid")) carbon(event.target as Element);
      }}
    >
      <input type="hidden" name="locale" value={locale} />
      <Field label={t("email")} icon="mail" name="email" type="email" autoComplete="username" />
      <Field
        label={t("password")}
        icon="lock"
        name="password"
        type="password"
        autoComplete="current-password"
      />
      <button
        type="submit"
        disabled={!hydrated || pending}
        className="btn btn-primary mt-[.55rem] min-h-[52px] w-full justify-between px-[1.2rem]"
      >
        <span>{c("enterPortal")}</span>
        <Icon name="arrow" mirror />
      </button>
      <p ref={errorRef} role="alert" className="alert-error">
        {state.error ? t(errorKeys[state.error]) : ""}
      </p>
    </form>
  );
}

function Field({
  label,
  icon,
  ...input
}: { label: string; icon: string } & React.ComponentProps<"input">) {
  return (
    <label className="mb-[1.05rem]">
      <span>{label}</span>
      <span className="relative mt-[.4rem] block">
        <Icon
          name={icon}
          className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-muted"
        />
        <input {...input} required className="m-0 h-[50px] ps-[2.95rem] pe-[.8rem] rtl:pe-4" />
      </span>
    </label>
  );
}
