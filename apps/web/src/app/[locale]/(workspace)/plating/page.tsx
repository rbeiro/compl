import { Suspense } from "react";
import { SectionGate, sectionMetadata, SectionTitle } from "@/components/workspace/section";

export const generateMetadata = () => sectionMetadata("plating");

// TODO(port): legacy section "plating". Placeholder until the screen is ported.
export default function Page() {
  return (
    <>
      <SectionTitle section="plating" />
      <Suspense>
        <SectionGate section="plating">{null}</SectionGate>
      </Suspense>
    </>
  );
}
