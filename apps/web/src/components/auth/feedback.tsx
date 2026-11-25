"use client";

import { useEffect, useRef } from "react";
import { carbon } from "@/lib/motion";

/** Legacy `.feedback` status line: green box, announced, animated when it changes. */
export function Feedback({ message, className = "" }: { message?: string | null; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (message) carbon(ref.current);
  }, [message]);
  return (
    <p ref={ref} role="status" aria-live="polite" className={`alert-ok ${className}`}>
      {message ?? ""}
    </p>
  );
}
