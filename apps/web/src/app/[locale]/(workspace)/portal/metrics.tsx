"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { sequence } from "@/lib/motion";

/** Metric cards row; plays the "workspace-home" sequence on arrival. */
export function Metrics({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => sequence(Array.from(ref.current?.children ?? [])), []);
  return (
    <section ref={ref} aria-label={label} className="ws-metrics mb-[1.4rem] grid grid-cols-4 gap-[.86rem] max-960:grid-cols-2 max-580:gap-[.64rem]">
      {children}
    </section>
  );
}
