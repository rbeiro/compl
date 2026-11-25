import { Suspense } from "react";
import { SectionGate, sectionMetadata, SectionTitle } from "@/components/workspace/section";

export const generateMetadata = () => sectionMetadata("generar");

// TODO(port): legacy section "generar". Placeholder until the screen is ported.
export default function Page() {
  return (
    <>
      <SectionTitle section="generar" />
      <Suspense>
        <SectionGate section="generar">{null}</SectionGate>
      </Suspense>
    </>
  );
}
