"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { resendCode, verifyCode, type VerifyState } from "@/app/actions/auth";
import { Feedback } from "@/components/auth/feedback";
import { Field, submitClass } from "@/components/auth/field";

export function VerifyForm() {
  const t = useTranslations("Verification");
  const locale = useLocale();
  const [verify, verifyAction, verifying] = useActionState<VerifyState, FormData>(verifyCode, {});
  const [resend, resendAction, resending] = useActionState<VerifyState, FormData>(resendCode, {});
  // The form used last decides the message.
  const [last, setLast] = useState<"verify" | "resend">("verify");
  const message =
    last === "verify"
      ? verify.error ? t(verify.error) : null
      : resend.resent ? t("resent") : resend.wait ? t("wait") : resend.error ? t("failed") : null;

  return (
    <>
      <form action={verifyAction} onSubmit={() => setLast("verify")}>
        <input type="hidden" name="locale" value={locale} />
        <Field
          label={t("codeLabel")}
          name="code"
          dir="ltr"
          inputMode="numeric"
          pattern="[0-9٠-٩۰-۹]{6}"
          maxLength={6}
          autoComplete="one-time-code"
          required
          autoFocus
          key={verify.error ? JSON.stringify(verify) : "code"}
        />
        <button type="submit" disabled={verifying} className={submitClass}>
          {t("submit")}
        </button>
      </form>
      <Feedback message={message} />
      <form action={resendAction} onSubmit={() => setLast("resend")}>
        <input type="hidden" name="locale" value={locale} />
        <button type="submit" disabled={resending} className="btn mt-4">
          {t("resend")}
        </button>
      </form>
    </>
  );
}
