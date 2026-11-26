import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Link } from "@/i18n/navigation";
import { loadWorkspace } from "@/lib/workspace";
import { BrandSettings } from "../../generar/[[...path]]/_components/brand-settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Workspace");
  const g = await getTranslations("Generator");
  return { title: t("pageTitle", { section: g("marcaDeLasFichas") }) };
}

const h1 = "m-0 mb-[1.1rem] text-[clamp(2rem,2.9vw,2.7rem)] text-(--ws-deep)";

// Legacy #/marca and #/marca/<hotel>: the document brand of the executive chef's hotels.
export default function BrandPage({ params }: PageProps<"/[locale]/marca/[[...hotel]]">) {
  return (
    <Suspense>
      <Brand params={params} />
    </Suspense>
  );
}

async function Brand({ params }: { params: PageProps<"/[locale]/marca/[[...hotel]]">["params"] }) {
  const t = await getTranslations("Generator");
  const workspace = await loadWorkspace();
  if (workspace.status !== "ok") return null;
  const hotels = workspace.access
    .filter((a) => a.accessRank === 1)
    .map((a) => ({ key: a.hotelKey, name: workspace.outlets.find((o) => o.hotelKey === a.hotelKey)?.hotel ?? a.hotelKey }));
  const parts = (await params).hotel ?? [];
  const selected = parts.length ? decodeURIComponent(parts[0]!) : hotels[0]?.key;
  if (!selected || parts.length > 1 || !hotels.some((h) => h.key === selected)) {
    return (
      <>
        <h1 className={h1}>{t("accesoRestringido")}</h1>
        <Link href="/portal">{t("volverAMiEntorno")}</Link>
      </>
    );
  }
  return (
    <>
      <h1 className={h1}>{t("marcaDeLasFichas")}</h1>
      <Link href="/generar">{t("generacionDeRecetas")}</Link>
      <BrandSettings hotels={hotels} selected={selected} />
    </>
  );
}
