// Icons from the legacy SVG sprite (public/brand/ui.svg).
export function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={`inline-block size-5 shrink-0 fill-none stroke-current stroke-[1.65] [stroke-linecap:round] [stroke-linejoin:round] rtl:-scale-x-100 ${className}`}
    >
      <use href={`/brand/ui.svg#${name}`} />
    </svg>
  );
}
