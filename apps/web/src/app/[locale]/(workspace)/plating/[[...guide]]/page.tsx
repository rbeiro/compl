import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { SectionGate, sectionMetadata } from "@/components/workspace/section";
import { loadAllGuides } from "@/lib/workspace";
import { PlatingView } from "../_components/plating-view";

export const generateMetadata = () => sectionMetadata("plating");

// Legacy #/plating and #/plating/<hotel>/<outlet>/<guide>.
export default function PlatingPage({ params }: PageProps<"/[locale]/plating/[[...guide]]">) {
  return (
    <Suspense>
      <SectionGate section="plating">
        <Plating params={params} />
      </SectionGate>
    </Suspense>
  );
}

async function Plating({ params }: { params: PageProps<"/[locale]/plating/[[...guide]]">["params"] }) {
  const { guide = [] } = await params;
  const rows = await loadAllGuides();
  const parts = guide.map(decodeURIComponent);
  const selected = parts.length === 3 ? rows.find((r) => [r.hotelKey, r.outletKey, r.guideKey].join("/") === parts.join("/")) : null;
  if (parts.length && !selected) {
    const t = await getTranslations("Plating");
    return <p className="alert-error">{t("unavailable")}</p>;
  }
  return <PlatingView rows={rows} selectedKey={selected ? parts.join("/") : null} />;
}
