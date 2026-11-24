"use client";

import * as Select from "@radix-ui/react-select";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useSyncExternalStore, useTransition } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { languageNames, rtlLocales, type Locale } from "@/i18n/routing";
import { carbon } from "@/lib/motion";

// Port of the legacy `[data-language-picker]` (i18n.js + language.css + select-menu.css).
// "auto" follows the browser language: it is the state when no locale cookie is set.
const COOKIE = "NEXT_LOCALE";
const AUTO = "auto";

function readPreference() {
  return document.cookie.split("; ").some((c) => c.startsWith(COOKIE + "=")) ? "explicit" : AUTO;
}

export function LanguagePicker() {
  const t = useTranslations("Common");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const nameRef = useRef<HTMLSpanElement>(null);
  const firstRender = useRef(true);

  // Server renders the resolved locale; the client then reflects the cookie.
  const preference = useSyncExternalStore(
    () => () => {},
    readPreference,
    () => "explicit",
  );
  const value = preference === AUTO ? AUTO : locale;

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    carbon(nameRef.current);
  }, [locale]);

  function choose(next: string) {
    if (next === AUTO) {
      // Forget the choice and let the proxy pick the browser language again.
      document.cookie = `${COOKIE}=; path=/; max-age=0; samesite=lax`;
      window.location.assign(pathname + window.location.hash);
      return;
    }
    document.cookie = `${COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => router.replace(pathname, { locale: next as Locale }));
  }

  return (
    <Select.Root value={value} onValueChange={choose} dir={rtlLocales.has(locale) ? "rtl" : "ltr"}>
      <Select.Trigger
        aria-label={t("chooseLanguage")}
        title={t("chooseLanguage")}
        className="relative inline-flex min-h-11 min-w-11 flex-none cursor-pointer items-center justify-center gap-[.42rem] rounded-control border border-green bg-white px-[.7rem] py-[.35rem] text-green outline-offset-2 hover:shadow-[inset_0_0_0_1px_var(--color-green)] focus-visible:shadow-[inset_0_0_0_1px_var(--color-green)] focus-visible:outline-2 data-[state=open]:shadow-[inset_0_0_0_1px_var(--color-green)] max-960:p-[.35rem]"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="size-[1.1rem] flex-none fill-none stroke-current stroke-[1.65]"
        >
          <circle cx="12" cy="12" r="9" />
          <ellipse cx="12" cy="12" rx="4" ry="9" />
          <path d="M3 12h18" />
        </svg>
        <span
          ref={nameRef}
          lang={locale}
          aria-hidden="true"
          className="text-[.83rem]/[1.3] font-semibold max-960:hidden"
        >
          {languageNames[locale]}
        </span>
        <span
          aria-hidden="true"
          className="block h-[.55rem] flex-[0_0_.65rem] bg-[url(/brand/select-chevron.svg)] bg-contain bg-center bg-no-repeat max-440:hidden"
        />
      </Select.Trigger>

      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={5}
          align="end"
          className="z-[1100] box-border w-max max-w-[calc(100vw-16px)] min-w-[min(var(--radix-select-trigger-width),calc(100vw-16px))] overflow-hidden rounded-menu border border-green bg-white text-start text-[.9rem]/[1.4] font-medium text-green shadow-menu motion-safe:animate-menu-open"
        >
          <Select.Viewport className="max-h-[min(22.5rem,60dvh)] overscroll-contain p-[.3rem]">
            <MenuItem value={AUTO}>{t("useDeviceLanguage")}</MenuItem>
            {Object.entries(languageNames).map(([code, name]) => (
              <MenuItem
                key={code}
                value={code}
                lang={code}
                dir={rtlLocales.has(code as Locale) ? "rtl" : "ltr"}
              >
                {name}
              </MenuItem>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

function MenuItem({
  children,
  ...props
}: Select.SelectItemProps & { lang?: string; dir?: "ltr" | "rtl" }) {
  return (
    <Select.Item
      {...props}
      className="flex min-h-[42px] cursor-pointer items-center gap-[.65rem] rounded-[6px] bg-white px-[.72rem] py-[.52rem] text-green outline-none select-none data-[highlighted]:outline-1 data-[highlighted]:-outline-offset-2 data-[highlighted]:outline-green data-[highlighted]:outline-solid pointer-coarse:min-h-[46px]"
    >
      <Select.ItemText>{children}</Select.ItemText>
      <Select.ItemIndicator className="ms-auto flex-none">✓</Select.ItemIndicator>
    </Select.Item>
  );
}
