"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect, useRef } from "react";
import { recoverPassword, type RecoverState } from "@/app/actions/auth";
import { Feedback } from "@/components/auth/feedback";
import { Field, submitClass } from "@/components/auth/field";
import { Link } from "@/i18n/navigation";

const messages = { mismatch: "mismatch", weak: "weak", invalid: "invalid", failed: "failed", wait: "failed" } as const;

export function RecoverForm() {
  const t = useTranslations("Recovery");
  const [state, action, pending] = useActionState<RecoverState, FormData>(recoverPassword, {});
  const back = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (state.done) back.current?.focus();
  }, [state.done]);

  return (
    <>
      {!state.done && (
        <form action={action}>
          <Field label={t("email")} name="email" type="email" autoComplete="username" maxLength={254} dir="ltr" required />
          <Field
            label={t("code")}
            name="code"
            autoComplete="off"
            maxLength={80}
            spellCheck={false}
            autoCapitalize="characters"
            dir="ltr"
            required
          />
          <Field label={t("newPassword")} name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />
          <Field label={t("repeat")} name="repeat" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />
          <button type="submit" disabled={pending} className={submitClass}>
            {t("submit")}
          </button>
        </form>
      )}
      <Feedback message={state.done ? t("done") : state.error ? t(messages[state.error]) : null} />
      <Link ref={back} href="/acceso">
        {t("back")}
      </Link>
    </>
  );
}
