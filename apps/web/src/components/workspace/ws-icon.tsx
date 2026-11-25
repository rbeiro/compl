import { twMerge } from "tailwind-merge";

// Legacy workspaceIcon(): rail icons come from workspace.svg, the rest from ui.svg.
const railIcons = new Set(["home", "users", "plating", "menu", "close", "sun", "plus"]);
const aliases: Record<string, string> = { location: "hotel", generate: "compose" };

export function WsIcon({ name, className = "" }: { name: string; className?: string }) {
  const href = railIcons.has(name) ? `/brand/workspace.svg#${name}` : `/brand/ui.svg#${aliases[name] ?? name}`;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={twMerge("size-5 flex-none fill-none stroke-current stroke-[1.65] [stroke-linecap:round] [stroke-linejoin:round]", className)}
    >
      <use href={href} />
    </svg>
  );
}
