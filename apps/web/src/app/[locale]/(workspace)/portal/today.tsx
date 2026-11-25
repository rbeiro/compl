"use client";

import { useLocale } from "next-intl";
import { useSyncExternalStore } from "react";

/** Today's date in the user's language and time zone (legacy `.ws-today`). */
export function Today({ className }: { className: string }) {
  const locale = useLocale();
  const now = useSyncExternalStore(
    () => () => {},
    () => new Date().toDateString(),
    () => null,
  );
  if (!now) return <time className={className} />;
  const date = new Date(now);
  const iso = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  return (
    <time dateTime={iso} className={className}>
      {new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(date)}
    </time>
  );
}
