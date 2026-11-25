import { twMerge } from "tailwind-merge";

// Icons from the legacy SVG sprite (public/brand/ui.svg), styled like `.icon`.
// `mirror` flips directional icons in right-to-left languages.
export function Icon({
  name,
  className = "",
  mirror = false,
}: {
  name: string;
  className?: string;
  mirror?: boolean;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={twMerge(
        "size-5 flex-none fill-none stroke-current stroke-[1.65] [stroke-linecap:round] [stroke-linejoin:round]",
        mirror && "rtl:scale-x-[-1]",
        className,
      )}
    >
      <use href={`/brand/ui.svg#${name}`} />
    </svg>
  );
}
