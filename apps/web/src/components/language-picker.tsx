"use client";

import { useLocale } from "next-intl";
import { useTransition } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { languageNames, type Locale } from "@/i18n/routing";

export function LanguagePicker({ label }: { label: string }) {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  return (
    <label className="relative">
      <span className="sr-only">{label}</span>
      <select
        value={locale}
        disabled={pending}
        onChange={(event) => {
          const next = event.target.value as Locale;
          startTransition(() => router.replace(pathname, { locale: next }));
        }}
        className="h-target cursor-pointer rounded-control border border-line bg-surface px-3 text-sm"
      >
        {Object.entries(languageNames).map(([code, name]) => (
          <option key={code} value={code} lang={code}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}
