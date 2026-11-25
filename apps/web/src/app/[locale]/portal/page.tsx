import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { SiteHeader } from "@/components/site-header";
import { redirect } from "@/i18n/navigation";
import { getApi, sessionDestination } from "@/lib/api";

// Workspace entry point. The proxy already redirects anonymous visitors; the
// API (and the database rules behind it) decide what the user can see.
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
  const api = await getApi();
  if (!api) return redirect({ href: "/acceso", locale });

  // Two-step verification / temporary password come first, as in the legacy portal.
  const destination = await sessionDestination(api);
  if (destination !== "/portal") return redirect({ href: destination ?? "/acceso", locale });

  const [me, outlets, guides] = await Promise.all([
    api.GET("/v1/me"),
    api.GET("/v1/outlets"),
    api.GET("/v1/guides", { params: { query: { limit: 200 } } }),
  ]);
  if (me.response.status === 401) return redirect({ href: "/acceso", locale });
  if (!me.data || !outlets.data || !guides.data) {
    throw new Error("The workspace could not be loaded from the API.");
  }

  // TODO(port): workspace shell (legacy workspace-shell.js): guides, recipes,
  // costs, mail, schedules, staff. This placeholder only proves the data flow.
  return (
    <div className="space-y-6" data-testid="workspace">
      <p className="text-muted">{me.data.email}</p>
      <ul className="space-y-1">
        {me.data.hotels.map((h) => (
          <li key={h.hotelKey}>
            {h.hotelKey} · rank {h.accessRank}
          </li>
        ))}
      </ul>
      <ul className="space-y-1" aria-label="Outlets">
        {outlets.data.items.map((o) => (
          <li key={`${o.hotelKey}/${o.outletKey}`}>
            {o.outlet} ({guides.data.items.filter((g) => g.hotelKey === o.hotelKey && g.outletKey === o.outletKey).length})
          </li>
        ))}
      </ul>
      <SignOutButton />
    </div>
  );
}
