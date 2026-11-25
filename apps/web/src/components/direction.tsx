"use client";

import { DirectionProvider } from "@radix-ui/react-direction";
import type { ReactNode } from "react";

/** Gives Radix components (selects, dialogs, popovers) the page direction; they default to LTR. */
export function Direction({ dir, children }: { dir: "ltr" | "rtl"; children: ReactNode }) {
  return <DirectionProvider dir={dir}>{children}</DirectionProvider>;
}
