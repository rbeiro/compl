import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";
import { AuthContent } from "./auth-content";

/**
 * Centred single-column auth view (legacy `.auth-content.recovery-view` inside
 * `main.shell.auth-view`): recovery, password change, two-step verification.
 */
export function AuthPage({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader variant="shell" />
      <main id="main" tabIndex={-1} className="shell py-[clamp(2rem,5vw,4.25rem)] max-720:pt-[1.8rem] max-720:pb-12">
        <AuthContent className="mx-auto w-[min(100%,31rem)] py-6 max-720:p-0">{children}</AuthContent>
      </main>
    </>
  );
}
