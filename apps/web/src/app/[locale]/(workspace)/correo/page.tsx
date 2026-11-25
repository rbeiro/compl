import { Suspense } from "react";
import { SectionGate, sectionMetadata, SectionTitle } from "@/components/workspace/section";

export const generateMetadata = () => sectionMetadata("correo");

// TODO(port): legacy section "correo". Placeholder until the screen is ported.
export default function Page() {
  return (
    <>
      <SectionTitle section="correo" />
      <Suspense>
        <SectionGate section="correo">{null}</SectionGate>
      </Suspense>
    </>
  );
}
