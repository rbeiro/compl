import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { SectionGate, sectionMetadata, SectionTitle } from "@/components/workspace/section";
import { getApi } from "@/lib/api";
import { loadWorkspace } from "@/lib/workspace";
import { GeneratorView } from "./_components/generator-view";
import type { InitialSource } from "./_components/recipe-generator";

export const generateMetadata = () => sectionMetadata("generar");

// Legacy #/generar, #/generar/<hotel>/<outlet> and #/generar/<hotel>/<outlet>/<draft>.
export default function GeneratorPage({ params }: PageProps<"/[locale]/generar/[[...path]]">) {
  return (
    <>
      <SectionTitle section="generar" />
      <Suspense>
        <SectionGate section="generar">
          <Generator params={params} />
        </SectionGate>
      </Suspense>
    </>
  );
}

async function Generator({ params }: { params: PageProps<"/[locale]/generar/[[...path]]">["params"] }) {
  const t = await getTranslations("Generator");
  const workspace = await loadWorkspace();
  if (workspace.status !== "ok") return null;
  const editors = new Set(workspace.access.filter((a) => a.accessRank === 1 || a.accessRank === 2).map((a) => a.hotelKey));
  if (!editors.size) return <p>{t("estaFuncionRequierePermiso")}</p>;
  const destinations = workspace.outlets.filter((o) => editors.has(o.hotelKey));
  const parts = ((await params).path ?? []).map(decodeURIComponent);
  let selected: number | null = null;
  if (parts.length) {
    selected = destinations.findIndex((o) => o.hotelKey === parts[0] && o.outletKey === parts[1] && (parts.length === 2 || parts.length === 3));
    if (selected < 0) return <p className="alert-error">{t("outletNoDisponiblePara")}</p>;
  }
  let initialSource: InitialSource | undefined;
  if (parts.length === 3) {
    const api = await getApi();
    const { data } = (await api?.GET("/v1/guides/{h}/{o}/{g}/source", { params: { path: { h: parts[0]!, o: parts[1]!, g: parts[2]! } } })) ?? {};
    if (!data) return <p className="alert-error">{t("documentoNoDisponible")}</p>;
    const source = data.source as { data: Record<string, unknown>; media?: Record<string, unknown>; assets?: Record<string, { sha256: string; name?: string }>; imagen_aprobada?: { tipo: string } | null };
    initialSource = {
      guideKey: parts[2]!,
      revision: data.revision,
      data: { ...source.data },
      media: { ...(source.media ?? {}), assets: source.assets, approved: source.imagen_aprobada } as InitialSource["media"],
    };
  }
  const admins = workspace.access.filter((a) => a.accessRank === 1).map((a) => a.hotelKey);
  const brandHotels = admins.map((key) => ({ key, name: workspace.outlets.find((o) => o.hotelKey === key)?.hotel ?? key }));
  return <GeneratorView destinations={destinations} selected={selected} initialSource={initialSource} brandHotels={brandHotels} />;
}
