"use client";

import { useDirection } from "@radix-ui/react-direction";
import * as Popover from "@radix-ui/react-popover";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { PickerIcon } from "./month-picker";
import styles from "./pickers.module.css";

// Port of attachColorPicker (legacy workspace-pickers.js): brand palette and
// a custom six-digit code. Value is "#RRGGBB".

const cx = (...names: (string | false | null | undefined)[]) =>
  names.filter(Boolean).map((n) => `${styles[n as string] ?? ""} ${n}`).join(" ");

const palette = ["#23603F", "#183C31", "#4F6C59", "#596976", "#284C60", "#725B47", "#915846", "#7B4359", "#222D28", "#8E8968", "#D9CDB7", "#FFFFFF"];
export const hexColor = (value: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  return m ? `#${m[1]!.toUpperCase()}` : null;
};

export function ColorPicker({ value, onChange, id, disabled }: { value: string; onChange: (value: string) => void; id?: string; disabled?: boolean }) {
  const t = useTranslations("Pickers");
  const rtl = useDirection() === "rtl";
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const code = hexColor(value);
  const valid = !!hexColor(custom);
  const commit = (next: string) => {
    onChange(next);
    setOpen(false);
  };
  return (
    <Popover.Root
      open={open}
      modal
      onOpenChange={(next) => {
        if (next) setCustom(code ?? "");
        setOpen(next);
      }}
    >
      <Popover.Trigger id={id} disabled={disabled} className={cx("wp-trigger")} aria-label={`${t("chooseColor")} · ${code ?? ""}`}>
        <span className={cx("wp-swatch")} style={{ backgroundColor: code ?? undefined }} />
        <bdi dir="ltr">{code}</bdi>
        <PickerIcon name="down" />
      </Popover.Trigger>
      <Popover.Portal>
        <>
          {open && <div className={cx("wp-backdrop")} aria-hidden="true" />}
          <Popover.Content
            role="dialog"
            aria-label={t("chooseColor")}
            className={cx("wp-dialog", "wp-color")}
            side="bottom"
            align={rtl ? "end" : "start"}
            sideOffset={6}
            collisionPadding={10}
          >
            <header className={cx("wp-heading")}>
              <h2>{t("chooseColor")}</h2>
              <Popover.Close className={cx("wp-icon-button")} aria-label={t("close")}>
                <PickerIcon name="close" />
              </Popover.Close>
            </header>
            <div className={cx("wp-color-current")}>
              <span>{t("currentColor")}</span>
              <bdi dir="ltr">{code}</bdi>
            </div>
            <div className={cx("wp-palette")} role="group" aria-label={t("palette")}>
              {palette.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className={cx("wp-choice")}
                  style={{ "--wp-chip": chip } as React.CSSProperties}
                  aria-label={chip}
                  title={chip}
                  aria-pressed={chip === code}
                  onClick={() => commit(chip)}
                />
              ))}
            </div>
            <label className={cx("wp-custom")}>
              <span>{t("customColor")}</span>
              <input
                type="text"
                dir="ltr"
                maxLength={7}
                spellCheck={false}
                autoComplete="off"
                value={custom}
                aria-invalid={!valid}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (valid) commit(hexColor(custom)!);
                  }
                }}
              />
            </label>
            <p className={cx("wp-color-error")} aria-live="polite">
              {valid ? "" : t("colorHint")}
            </p>
            <button type="button" className={cx("wp-primary")} disabled={!valid} onClick={() => commit(hexColor(custom)!)}>
              {t("applyColor")}
            </button>
          </Popover.Content>
        </>
      </Popover.Portal>
    </Popover.Root>
  );
}
