"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { carbon } from "@/lib/motion";

const signInColumn = "w-[min(100%,26rem)] py-6 max-720:m-auto max-720:w-full max-720:max-w-[32rem] max-720:p-0";

/** `.auth-content`: rises in when the page opens ("portal-access" / "recovery" motion). */
export function AuthContent({ children, className = signInColumn }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => carbon(ref.current), []);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
