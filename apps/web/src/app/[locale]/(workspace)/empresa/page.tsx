import { Suspense } from "react";
import { SectionGate, sectionMetadata, SectionTitle } from "@/components/workspace/section";

export const generateMetadata = () => sectionMetadata("archivo");

// TODO(port): legacy section "archivo". Placeholder until the screen is ported.
export default function Page() {
  return (
    <>
      <SectionTitle section="archivo" />
      <Suspense>
        <SectionGate section="archivo">{null}</SectionGate>
      </Suspense>
    </>
  );
}
