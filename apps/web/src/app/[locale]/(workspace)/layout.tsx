import { getLocale, getTranslations } from "next-intl/server";
import { Suspense, type ReactNode } from "react";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { redirect } from "@/i18n/navigation";
import { loadWorkspace } from "@/lib/workspace";

// Signed-in area: the rail + header frame around every workspace section.
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<Loading />}>
      <Frame>{children}</Frame>
    </Suspense>
  );
}

async function Frame({ children }: { children: ReactNode }) {
  const workspace = await loadWorkspace();
  if (workspace.status === "redirect") return redirect({ href: workspace.to, locale: await getLocale() });
  return (
    <WorkspaceShell links={workspace.links} hotel={workspace.hotelLabel}>
      {children}
    </WorkspaceShell>
  );
}

async function Loading() {
  const t = await getTranslations("Workspace");
  return (
    <p role="status" className="shell py-12 text-muted">
      {t("loading")}
    </p>
  );
}
