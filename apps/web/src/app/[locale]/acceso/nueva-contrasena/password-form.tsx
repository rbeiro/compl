"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState } from "react";
import { changePassword, type PasswordState } from "@/app/actions/auth";
import { Feedback } from "@/components/auth/feedback";
import { Field, submitClass } from "@/components/auth/field";

const messages = { mismatch: "mismatch", weak: "hint", failed: "failed" } as const;

export function PasswordForm() {
  const t = useTranslations("PasswordChange");
  const locale = useLocale();
  const [state, action, pending] = useActionState<PasswordState, FormData>(changePassword, {});
  return (
    <>
      <form action={action}>
        <input type="hidden" name="locale" value={locale} />
        <Field label={t("newPassword")} name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} autoFocus />
        <Field label={t("repeat")} name="repeat" type="password" autoComplete="new-password" required minLength={10} maxLength={128} />
        <p className="text-muted">{t("hint")}</p>
        <button type="submit" disabled={pending} className={submitClass}>
          {t("submit")}
        </button>
      </form>
      <Feedback message={state.error ? t(messages[state.error]) : null} />
    </>
  );
}
