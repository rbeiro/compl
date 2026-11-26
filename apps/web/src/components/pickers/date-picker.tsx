"use client";

import { useDirection } from "@radix-ui/react-direction";
import * as Popover from "@radix-ui/react-popover";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState, type KeyboardEvent } from "react";
import { PickerIcon } from "./month-picker";
import styles from "./pickers.module.css";

// Port of attachDatePicker (legacy workspace-pickers.js): a button with the
// formatted date that opens a month grid; arrows, Home/End and PageUp/PageDown
// move the focused day. Value is an ISO date (YYYY-MM-DD) or "".

const cx = (...names: (string | false | null | undefined)[]) =>
  names.filter(Boolean).map((n) => `${styles[n as string] ?? ""} ${n}`).join(" ");

// Local noon protects the civil date from daylight-saving changes; years 1–99 are literal.
function civil(year: number, month: number, day: number) {
  const d = new Date(2000, 0, 1, 12);
  d.setFullYear(year, month, day);
  return d;
}
const iso = (d: Date) => [String(d.getFullYear()).padStart(4, "0"), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, day] = value.split("-").map(Number);
  const date = civil(y!, m! - 1, day!);
  return y! > 0 && iso(date) === value ? date : null;
}
function monthOffset(date: Date, offset: number) {
  const first = civil(date.getFullYear(), date.getMonth() + offset, 1);
  const last = civil(first.getFullYear(), first.getMonth() + 1, 0);
  return civil(first.getFullYear(), first.getMonth(), Math.min(date.getDate(), last.getDate()));
}
function weekStart(lang: string) {
  const region = new Intl.Locale(lang).maximize() as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
  const info = region.getWeekInfo?.() ?? region.weekInfo;
  if (info?.firstDay) return info.firstDay % 7;
  return lang === "ar" ? 6 : lang === "en" ? 0 : 1;
}

export function DatePicker({
  value,
  onChange,
  id,
  describedBy,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  describedBy?: string;
}) {
  const t = useTranslations("Pickers");
  const locale = useLocale();
  const rtl = useDirection() === "rtl";
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(() => parseDate(value) ?? new Date());
  const table = useRef<HTMLTableElement>(null);
  const format = (options: Intl.DateTimeFormatOptions, date: Date) => new Intl.DateTimeFormat(locale, { calendar: "gregory", ...options }).format(date);
  const selected = parseDate(value);
  const label = selected ? format({ dateStyle: "medium" }, selected) : t("chooseDate");

  const move = (date: Date, focus = true) => {
    if (date.getFullYear() < 1 || date.getFullYear() > 9999) return;
    setFocused(date);
    if (focus) requestAnimationFrame(() => table.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true }));
  };
  const commit = (date: Date | null) => {
    onChange(date ? iso(date) : "");
    setOpen(false);
  };
  const start = weekStart(locale);
  const y = focused.getFullYear(), m = focused.getMonth();
  const first = civil(y, m, 1);
  const offset = (first.getDay() - start + 7) % 7;
  const days = civil(y, m + 1, 0).getDate();
  const now = iso(new Date());
  const digits = new Intl.NumberFormat(locale);
  const onKeyDown = (event: KeyboardEvent) => {
    if (!(event.target as Element).closest(".wp-day")) return;
    const idx = (focused.getDay() - start + 7) % 7;
    const shifts: Record<string, number> = { ArrowLeft: rtl ? 1 : -1, ArrowRight: rtl ? -1 : 1, ArrowUp: -7, ArrowDown: 7, Home: -idx, End: 6 - idx };
    if (event.key in shifts) {
      event.preventDefault();
      move(civil(y, m, focused.getDate() + shifts[event.key]!));
    } else if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      move(monthOffset(focused, (event.key === "PageUp" ? -1 : 1) * (event.shiftKey ? 12 : 1)));
    }
  };

  return (
    <Popover.Root
      open={open}
      modal
      onOpenChange={(next) => {
        if (next) setFocused(parseDate(value) ?? new Date());
        setOpen(next);
      }}
    >
      <Popover.Trigger
        id={id}
        className={cx("wp-trigger")}
        aria-describedby={describedBy}
        aria-label={selected ? `${t("chooseDate")} · ${format({ dateStyle: "full" }, selected)}` : t("chooseDate")}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M4 8h16M8 3v4m8-4v4M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1z" />
        </svg>
        <span>{label}</span>
        <PickerIcon name="down" />
      </Popover.Trigger>
      <Popover.Portal>
        <>
          {open && <div className={cx("wp-backdrop")} aria-hidden="true" />}
          <Popover.Content
            role="dialog"
            aria-label={t("chooseDate")}
            className={cx("wp-dialog", "wp-calendar")}
            side="bottom"
            align={rtl ? "end" : "start"}
            sideOffset={6}
            collisionPadding={10}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              table.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true });
            }}
          >
            <header className={cx("wp-heading")}>
              <h2>{t("chooseDate")}</h2>
              <Popover.Close className={cx("wp-icon-button")} aria-label={t("close")}>
                <PickerIcon name="close" />
              </Popover.Close>
            </header>
            <div className={cx("wp-month")}>
              <button type="button" className={cx("wp-icon-button")} aria-label={t("previousMonth")} disabled={y === 1 && m === 0} onClick={() => move(monthOffset(focused, -1), false)}>
                <PickerIcon name="previous" />
              </button>
              <strong aria-live="polite">{format({ month: "long", year: "numeric" }, first)}</strong>
              <button type="button" className={cx("wp-icon-button")} aria-label={t("nextMonth")} disabled={y === 9999 && m === 11} onClick={() => move(monthOffset(focused, 1), false)}>
                <PickerIcon name="next" />
              </button>
            </div>
            <table ref={table} className={cx("wp-dates")} role="grid" onKeyDown={onKeyDown}>
              <thead>
                <tr>
                  {Array.from({ length: 7 }, (_, i) => {
                    const weekday = civil(2024, 0, 7 + start + i);
                    return (
                      <th key={i} scope="col" abbr={format({ weekday: "long" }, weekday)}>
                        {format({ weekday: "short" }, weekday)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: Math.ceil((offset + days) / 7) }, (_, week) => (
                  <tr key={week}>
                    {Array.from({ length: 7 }, (_, col) => {
                      const day = week * 7 + col - offset + 1;
                      if (day < 1 || day > days) return <td key={col} />;
                      const date = civil(y, m, day);
                      const key = iso(date);
                      return (
                        <td key={col} aria-selected={key === value}>
                          <button
                            type="button"
                            className={cx("wp-day")}
                            data-date={key}
                            tabIndex={day === focused.getDate() ? 0 : -1}
                            aria-label={format({ dateStyle: "full" }, date)}
                            aria-current={key === now ? "date" : undefined}
                            onClick={() => commit(date)}
                          >
                            {digits.format(day)}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={cx("wp-footer")}>
              <button type="button" className={cx("wp-minor")} disabled={!value} onClick={() => commit(null)}>
                {t("clearDate")}
              </button>
              <button type="button" className={cx("wp-primary")} onClick={() => commit(new Date())}>
                {t("today")}
              </button>
            </div>
          </Popover.Content>
        </>
      </Popover.Portal>
    </Popover.Root>
  );
}
