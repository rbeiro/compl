import type { ComponentProps } from "react";
import { Icon } from "@/components/icon";

/** Label + input as in the legacy auth forms (`.auth-content label`, optional `.input-wrap` icon). */
export function Field({
  label,
  icon,
  className = "",
  ...input
}: { label: string; icon?: string } & ComponentProps<"input">) {
  return (
    <label className={`mb-[1.05rem] ${className}`}>
      <span>{label}</span>
      {icon ? (
        <span className="relative mt-[.4rem] block">
          <Icon name={icon} className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-muted" />
          <input {...input} className="m-0 h-[50px] ps-[2.95rem] pe-[.8rem] rtl:pe-4" />
        </span>
      ) : (
        <input {...input} />
      )}
    </label>
  );
}

/** Full-width primary submit (`.auth-content .primary`). */
export const submitClass = "btn btn-primary mt-[.55rem] min-h-[52px] w-full justify-between px-[1.2rem]";
