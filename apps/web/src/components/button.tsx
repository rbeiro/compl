import type { ComponentProps } from "react";

// Shared look for primary actions. Swap for shadcn/ui once more variants are needed.
export const buttonClass =
  "inline-flex min-h-target items-center justify-center gap-2 rounded-control bg-primary px-5 font-semibold text-on-primary transition-colors hover:bg-green-hover active:bg-green-active disabled:cursor-not-allowed disabled:opacity-60";

export function Button({ className = "", ...props }: ComponentProps<"button">) {
  return <button className={`${buttonClass} ${className}`} {...props} />;
}
