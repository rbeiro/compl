import { Suspense } from "react";
import { SectionGate, sectionMetadata } from "@/components/workspace/section";
import { loadAllGuides, loadWorkspace } from "@/lib/workspace";
import { CostBook } from "./cost-book";

export const generateMetadata = () => sectionMetadata("escandallos");

// Legacy #/escandallos and #/escandallos/catalogo (cost-book.js): the screen
// replaces the section heading. Executive chefs only, for their hotels.
export default function CostsPage() {
  return (
    <Suspense>
      <SectionGate section="escandallos">
        <Costs />
      </SectionGate>
    </Suspense>
  );
}

async function Costs() {
  const workspace = await loadWorkspace();
  if (workspace.status !== "ok") return null;
  const admins = workspace.access.filter((a) => a.accessRank === 1).map((a) => a.hotelKey);
  const rows = (await loadAllGuides()).filter((r) => admins.includes(r.hotelKey));
  return <CostBook rows={rows} plazaAvailable={admins.includes("hotel-arts-barcelona")} />;
}
