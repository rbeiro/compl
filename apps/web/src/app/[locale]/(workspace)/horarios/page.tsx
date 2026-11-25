import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { SectionGate, sectionMetadata, SectionTitle } from "@/components/workspace/section";
import { loadWorkspace } from "@/lib/workspace";
import { Schedules } from "./_components/schedules";

export const generateMetadata = () => sectionMetadata("horarios");

// Legacy #/horarios (horarios.js): rosters, leave requests and hours balances.
export default function SchedulesPage() {
  return (
    <>
      <SectionTitle section="horarios" />
      <Suspense>
        <SectionGate section="horarios">
          <Content />
        </SectionGate>
      </Suspense>
    </>
  );
}

async function Content() {
  const t = await getTranslations("Schedule");
  const workspace = await loadWorkspace();
  if (workspace.status !== "ok") return null;
  if (!workspace.access.length) return <p>{t("noHotel")}</p>;
  const hotels = workspace.access.map((a) => ({
    key: a.hotelKey,
    name: workspace.outlets.find((o) => o.hotelKey === a.hotelKey)?.hotel ?? a.hotelKey,
  }));
  return <Schedules hotels={hotels} />;
}
