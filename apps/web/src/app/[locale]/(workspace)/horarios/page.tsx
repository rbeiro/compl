import { Suspense } from "react";
import { SectionGate, sectionMetadata, SectionTitle } from "@/components/workspace/section";

export const generateMetadata = () => sectionMetadata("horarios");

// TODO(port): legacy section "horarios". Placeholder until the screen is ported.
export default function Page() {
  return (
    <>
      <SectionTitle section="horarios" />
      <Suspense>
        <SectionGate section="horarios">{null}</SectionGate>
      </Suspense>
    </>
  );
}
