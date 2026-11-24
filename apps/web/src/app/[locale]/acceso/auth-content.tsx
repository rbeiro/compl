"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { carbon } from "@/lib/motion";

// "portal-access" motion: the sign-in column rises in when the page opens.
export function AuthContent({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => carbon(ref.current), []);
  return (
    <div ref={ref} className="w-[min(100%,26rem)] py-6 max-720:m-auto max-720:w-full max-720:max-w-[32rem] max-720:p-0">
      {children}
    </div>
  );
}
