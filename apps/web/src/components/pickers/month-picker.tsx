"use client";

import { useDirection } from "@radix-ui/react-direction";
import * as Popover from "@radix-ui/react-popover";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState, type KeyboardEvent } from "react";
import styles from "./pickers.module.css";

// Port of attachMonthPicker (legacy workspace-pickers.js): a button showing
// "Month Year" that opens a modal panel with a year switcher and 12 months.
// Radix Popover (modal) provides focus trapping, Escape and outside clicks.

const cx = (...names: (string | false | null | undefined)[]) =>
  names.filter(Boolean).map((n) => `${styles[n as string] ?? ""} ${n}`).join(" ");

const paths = {
  previous: "m14 6-6 6 6 6",
  next: "m10 6 6 6-6 6",
  close: "m6 6 12 12M18 6 6 18",
  down: "m6 9 6 6 6-6",
};
export const PickerIcon = ({ name }: { name: keyof typeof paths }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d={paths[name]} />
  </svg>
);

const pad = (n: number) => String(n).padStart(2, "0");
const toMonth = (year: number, index: number) => `${String(year).padStart(4, "0")}-${pad(index + 1)}`;

/** "Diciembre 2026": month capitalized; Spanish drops the "de" between month and year. */
export function monthLabel(month: string, locale: string) {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, 1, 12));
  return new Intl.DateTimeFormat(locale, { calendar: "gregory", month: "long", year: "numeric", timeZone: "UTC" })
    .formatToParts(date)
    .map(({ type, value }) => {
      if (type === "month") return value.charAt(0).toLocaleUpperCase(locale) + value.slice(1);
      return locale === "es" && type === "literal" ? " " : value;
    })
    .join("");
}

export function MonthPicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (month: string) => void;
  className?: string;
}) {
  const t = useTranslations("Pickers");
  const locale = useLocale();
  const rtl = useDirection() === "rtl";
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(0);
  const [active, setActive] = useState(0);
  const months = useRef<HTMLDivElement>(null);
  const label = monthLabel(value, locale);
  const now = new Date();

  const show = (next: boolean) => {
    if (next) {
      const [y, m] = value.split("-").map(Number);
      setYear(y!);
      setActive(m! - 1);
    }
    setOpen(next);
  };
  const commit = (month: string) => {
    setOpen(false);
    onChange(month);
  };
  const move = (delta: number, focus: boolean) => {
    const d = new Date(Date.UTC(year, active + delta, 1));
    const y = d.getUTCFullYear();
    if (y < 1 || y > 9999) return;
    setYear(y);
    setActive(d.getUTCMonth());
    if (focus) requestAnimationFrame(() => months.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true }));
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const shifts: Record<string, number> = {
      ArrowLeft: rtl ? 1 : -1,
      ArrowRight: rtl ? -1 : 1,
      ArrowUp: -3,
      ArrowDown: 3,
      Home: -active,
      End: 11 - active,
      PageUp: -12,
      PageDown: 12,
    };
    if (event.key in shifts) {
      event.preventDefault();
      move(shifts[event.key]!, true);
    }
  };
  const short = new Intl.DateTimeFormat(locale, { calendar: "gregory", month: "short", timeZone: "UTC" });
  const long = new Intl.DateTimeFormat(locale, { calendar: "gregory", month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <Popover.Root open={open} onOpenChange={show} modal>
      <Popover.Trigger className={cx("wp-trigger", className)} aria-label={`${t("chooseMonth")} · ${label}`}>
        <span>{label}</span>
        <PickerIcon name="down" />
      </Popover.Trigger>
      <Popover.Portal>
        <>
          {open && <div className={cx("wp-backdrop")} aria-hidden="true" />}
          <Popover.Content
            role="dialog"
            aria-label={t("chooseMonth")}
            className={cx("wp-dialog", "wp-month-dialog")}
            side="bottom"
            align={rtl ? "end" : "start"}
            sideOffset={6}
            collisionPadding={10}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              months.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true });
            }}
          >
            <header className={cx("wp-heading")}>
              <h2>{t("chooseMonth")}</h2>
              <Popover.Close className={cx("wp-icon-button")} aria-label={t("close")}>
                <PickerIcon name="close" />
              </Popover.Close>
            </header>
            <div className={cx("wp-month")}>
              <button type="button" className={cx("wp-icon-button")} aria-label={t("previousYear")} disabled={year === 1} onClick={() => move(-12, false)}>
                <PickerIcon name="previous" />
              </button>
              <strong aria-live="polite">{new Intl.NumberFormat(locale, { useGrouping: false }).format(year)}</strong>
              <button type="button" className={cx("wp-icon-button")} aria-label={t("nextYear")} disabled={year === 9999} onClick={() => move(12, false)}>
                <PickerIcon name="next" />
              </button>
            </div>
            <div ref={months} className={cx("wp-months")} role="group" aria-label={t("chooseMonth")} onKeyDown={onKeyDown}>
              {Array.from({ length: 12 }, (_, i) => {
                const month = toMonth(year, i);
                const date = new Date(Date.UTC(year, i, 1, 12));
                return (
                  <button
                    key={month}
                    type="button"
                    className={cx("wp-month-choice")}
                    data-month={month}
                    aria-label={long.format(date)}
                    aria-pressed={value === month}
                    aria-current={year === now.getFullYear() && i === now.getMonth() ? "date" : undefined}
                    tabIndex={i === active ? 0 : -1}
                    onClick={() => commit(month)}
                  >
                    {short.format(date)}
                  </button>
                );
              })}
            </div>
            <div className={cx("wp-footer")}>
              <button type="button" className={cx("wp-primary")} onClick={() => commit(toMonth(now.getFullYear(), now.getMonth()))}>
                {t("currentMonth")}
              </button>
            </div>
          </Popover.Content>
        </>
      </Popover.Portal>
    </Popover.Root>
  );
}
