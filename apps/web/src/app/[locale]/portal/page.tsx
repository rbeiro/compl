import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { signOut } from "@/app/actions/auth";
import { Icon } from "@/components/icon";
import { SiteHeader } from "@/components/site-header";
import { redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";

// Workspace entry point. The proxy already redirects anonymous visitors;
// the check below is the authoritative one.
export default async function PortalPage() {
  const c = await getTranslations("Common");

  return (
    <>
      <SiteHeader variant="shell" />
      <main id="main" tabIndex={-1} className="shell py-[clamp(2rem,5vw,4.35rem)] pb-20">
        <h1>{c("myWorkspace")}</h1>
        <Suspense fallback={<p className="text-muted">…</p>}>
          <Workspace />
        </Suspense>
      </main>
    </>
  );
}

async function Workspace() {
  const locale = await getLocale();
  const user = await getCurrentUser();
  if (!user) redirect({ href: "/acceso", locale });

  const c = await getTranslations("Common");

  return (
    <div className="space-y-6">
      <p className="text-muted">{user?.email}</p>
      {/* TODO(port): workspace shell, guides, recipes, costs, mail, schedules, staff. */}
      <form action={signOut}>
        <input type="hidden" name="locale" value={locale} />
        <button type="submit" className="btn">
          <Icon name="logout" /> {c("signOut")}
        </button>
      </form>
    </div>
  );
}
