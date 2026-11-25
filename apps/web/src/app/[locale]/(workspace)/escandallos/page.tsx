import { Suspense } from "react";
import { SectionGate, sectionMetadata, SectionTitle } from "@/components/workspace/section";

export const generateMetadata = () => sectionMetadata("escandallos");

// TODO(port): legacy section "escandallos". Placeholder until the screen is ported.
export default function Page() {
  return (
    <>
      <SectionTitle section="escandallos" />
      <Suspense>
        <SectionGate section="escandallos">{null}</SectionGate>
      </Suspense>
    </>
  );
}
