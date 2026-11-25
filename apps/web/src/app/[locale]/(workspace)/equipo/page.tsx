import { Suspense } from "react";
import { SectionGate, sectionMetadata, SectionTitle } from "@/components/workspace/section";

export const generateMetadata = () => sectionMetadata("equipo");

// TODO(port): legacy section "equipo". Placeholder until the screen is ported.
export default function Page() {
  return (
    <>
      <SectionTitle section="equipo" />
      <Suspense>
        <SectionGate section="equipo">{null}</SectionGate>
      </Suspense>
    </>
  );
}
