import { Suspense } from "react";
import { SectionGate, sectionMetadata, SectionTitle } from "@/components/workspace/section";

export const generateMetadata = () => sectionMetadata("recetas");

// TODO(port): legacy section "recetas". Placeholder until the screen is ported.
export default function Page() {
  return (
    <>
      <SectionTitle section="recetas" />
      <Suspense>
        <SectionGate section="recetas">{null}</SectionGate>
      </Suspense>
    </>
  );
}
