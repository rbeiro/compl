"use client";

import * as Select from "@radix-ui/react-select";
import { twMerge } from "tailwind-merge";

// Single-choice select styled like the legacy native <select> with its
// customizable picker (legacy select-menu.css): green outline, chevron, and
// the same dropdown in every browser. Radix provides keyboard, type-ahead and
// screen-reader behavior.

export type SelectOption = { value: string; label: string };

/** Radix forbids "" as an item value; the empty choice is stored under this key. */
const EMPTY = "__all__";

export function SelectField({
  id,
  value,
  onValueChange,
  options,
  className = "",
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  className?: string;
  "aria-label"?: string;
}) {
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <Select.Root value={value === "" ? EMPTY : value} onValueChange={(v) => onValueChange(v === EMPTY ? "" : v)}>
      <Select.Trigger
        id={id}
        aria-label={ariaLabel}
        className={twMerge(
          "flex min-h-11 w-full min-w-0 cursor-pointer items-center justify-between gap-[.6rem] rounded-[8px] border border-green bg-white px-[.8rem] text-start text-green hover:shadow-[inset_0_0_0_1px_var(--color-green)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green data-[state=open]:shadow-[inset_0_0_0_1px_var(--color-green)]",
          className,
        )}
      >
        <span className="min-w-0 truncate">{current?.label}</span>
        <span
          aria-hidden="true"
          className="h-[.62rem] w-[.77rem] flex-none bg-[url(/brand/select-chevron.svg)] bg-contain bg-center bg-no-repeat transition-[rotate] duration-[190ms] in-data-[state=open]:rotate-180 motion-reduce:transition-none"
        />
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={5}
          align="start"
          className="z-[1100] box-border w-max max-w-[calc(100vw-16px)] min-w-[min(var(--radix-select-trigger-width),calc(100vw-16px))] overflow-hidden rounded-menu border border-green bg-white text-start text-[.9rem]/[1.4] font-medium text-green shadow-menu motion-safe:animate-menu-open"
        >
          <Select.Viewport className="max-h-[min(22.5rem,60dvh)] overscroll-contain p-[.3rem]">
            {options.map((option) => (
              <Select.Item
                key={option.value || EMPTY}
                value={option.value === "" ? EMPTY : option.value}
                className="flex min-h-[42px] cursor-pointer items-center gap-[.65rem] rounded-[6px] bg-white px-[.72rem] py-[.52rem] text-green outline-none select-none [overflow-wrap:anywhere] data-[highlighted]:outline-1 data-[highlighted]:-outline-offset-2 data-[highlighted]:outline-green data-[highlighted]:outline-solid data-[state=checked]:font-[650] pointer-coarse:min-h-[46px]"
              >
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator className="ms-auto flex-none">✓</Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
