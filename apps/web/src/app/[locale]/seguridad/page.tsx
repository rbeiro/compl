import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { SiteHeader } from "@/components/site-header";
import { Link, redirect } from "@/i18n/navigation";
import { getApi, sessionDestination } from "@/lib/api";
import { RecoveryCodePanel } from "./recovery-code-panel";

// Legacy #/seguridad: personal recovery code.
// TODO(port): render inside the workspace shell once it is ported.
export default async function SecurityPage() {
  const t = await getTranslations("Security");
  return (
    <>
      <SiteHeader variant="shell" />
      <main id="main" tabIndex={-1} className="shell py-[clamp(2rem,5vw,4.35rem)] pb-20">
        <h1>{t("title")}</h1>
        <Suspense fallback={<p className="text-muted">…</p>}>
          <Panel />
        </Suspense>
        <Link href="/portal" className="my-6 inline-block min-h-11">
          {t("back")}
        </Link>
      </main>
    </>
  );
}

async function Panel() {
  const locale = await getLocale();
  const api = await getApi();
  if (!api) return redirect({ href: "/acceso", locale });
  const destination = await sessionDestination(api);
  if (destination !== "/portal") return redirect({ href: destination ?? "/acceso", locale });
  const { data } = await api.GET("/v1/account/recovery-code");
  if (!data) throw new Error("Could not load the recovery code status.");
  return <RecoveryCodePanel configured={data.configured} />;
}
