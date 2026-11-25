"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";
import { acceptInvitation, type InvitationState } from "@/app/actions/auth";
import { Feedback } from "@/components/auth/feedback";
import { Field, submitClass } from "@/components/auth/field";
import { Icon } from "@/components/icon";
import { carbon } from "@/lib/motion";

const KEY = "compi.invitation.ticket";

/** Reads the ticket from the URL fragment (never sent to servers or logs), then hides it. */
function useTicket() {
  const [ticket, setTicket] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let value: string | null = null;
    try {
      const hash = location.hash.slice(1);
      if (hash) {
        history.replaceState(null, "", location.pathname);
        value = /^v7_[a-f0-9]{64}$/.test(hash) ? hash : null;
        if (value) sessionStorage.setItem(KEY, value);
        else sessionStorage.removeItem(KEY);
      } else {
        value = sessionStorage.getItem(KEY);
      }
    } catch {
      value = null;
    }
    // Reading the fragment is only possible after mounting.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTicket(value);
  }, []);
  return ticket;
}

const errors = { mismatch: "mismatch", weak: "weak", failed: "failed", interrupted: "interrupted", wait: "wait" } as const;

export function InvitationForm({ intro }: { intro: string }) {
  const t = useTranslations("Invitation");
  const locale = useLocale();
  const ticket = useTicket();
  const [state, action, pending] = useActionState<InvitationState, FormData>(acceptInvitation, {});
  const unavailable = ticket === null || !!state.unavailable;

  useEffect(() => {
    if (state.unavailable) sessionStorage.removeItem(KEY);
    if (unavailable) carbon(document.getElementById("intro"));
  }, [state.unavailable, unavailable]);

  const message =
    state.unavailable === "expired" ? t("expired")
    : state.unavailable === "activated" ? t("activated")
    : state.error ? t(errors[state.error])
    : null;

  return (
    <>
      <p id="intro" className="mb-[2.1rem] max-w-[38ch] text-[1.05rem] text-muted max-720:mb-6">
        {unavailable ? t("unavailable") : intro}
      </p>
      {ticket && !state.unavailable && (
        <form action={action}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="ticket" value={ticket} />
          <Field label={t("password")} icon="lock" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required autoFocus />
          <Field label={t("repeat")} icon="lock" name="repeat" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />
          <button type="submit" disabled={pending} className={submitClass}>
            <span>{t("submit")}</span>
            <Icon name="arrow" mirror />
          </button>
        </form>
      )}
      <Feedback message={message} />
    </>
  );
}
