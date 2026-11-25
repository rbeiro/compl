"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { issueRecoveryCode } from "@/app/actions/auth";
import { Feedback } from "@/components/auth/feedback";
import { useConfirm } from "@/components/confirm-dialog";
import { carbon } from "@/lib/motion";

// Port of legacy recovery.js `backupPanel`.
export function RecoveryCodePanel({ configured }: { configured: boolean }) {
  const t = useTranslations("Security");
  const [confirm, dialog] = useConfirm();
  const [pending, start] = useTransition();
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<"reauth" | "failed" | null>(null);
  const output = useRef<HTMLInputElement>(null);
  const label = useRef<HTMLLabelElement>(null);

  useEffect(() => {
    if (!code) return;
    output.current?.focus();
    output.current?.select();
    carbon(label.current);
  }, [code]);

  async function issue() {
    if (configured && !(await confirm({ message: t("confirmReplace"), accept: t("replace"), danger: true }))) return;
    setError(null);
    start(async () => {
      const result = await issueRecoveryCode();
      if (result.code) setCode(result.code.match(/.{1,5}/g)!.join("-"));
      else setError(result.error ?? "failed");
    });
  }

  return (
    <section className="max-w-[38rem]">
      <p className="mb-4">{t("intro")}</p>
      {code ? (
        <label ref={label} className="mt-4 block">
          <span>{t("yourCode")}</span>
          <input ref={output} readOnly value={code} spellCheck={false} dir="ltr" className="font-mono tracking-[.04em]" />
        </label>
      ) : (
        <>
          <p className="mb-4">{configured ? t("configured") : t("none")}</p>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={issue}>
            {configured ? t("replace") : t("generate")}
          </button>
        </>
      )}
      <Feedback message={code ? t("copyNow") : error ? t(error) : null} />
      {dialog}
    </section>
  );
}
