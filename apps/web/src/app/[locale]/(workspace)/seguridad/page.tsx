import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { SectionGate, sectionMetadata, SectionTitle } from "@/components/workspace/section";
import { Link } from "@/i18n/navigation";
import { loadWorkspace } from "@/lib/workspace";
import { RecoveryCodePanel } from "./recovery-code-panel";

export const generateMetadata = () => sectionMetadata("seguridad");

// Legacy #/seguridad: personal recovery code (recovery.js `backupPanel`).
export default async function SecurityPage() {
  return (
    <>
      <SectionTitle section="seguridad" />
      <Suspense>
        <SectionGate section="seguridad">
          <Panel />
        </SectionGate>
      </Suspense>
    </>
  );
}

async function Panel() {
  const t = await getTranslations("Security");
  const workspace = await loadWorkspace();
  if (workspace.status !== "ok") return null;
  const { data } = await workspace.api.GET("/v1/account/recovery-code");
  if (!data) throw new Error("Could not load the recovery code status.");
  return (
    <>
      <RecoveryCodePanel configured={data.configured} />
      <Link href="/portal" className="my-6 inline-block min-h-11">
        {t("back")}
      </Link>
    </>
  );
}
