import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { SectionGate, sectionMetadata, SectionTitle } from "@/components/workspace/section";
import { loadWorkspace } from "@/lib/workspace";
import { Mailbox } from "./_components/mailbox";

export const generateMetadata = () => sectionMetadata("correo");

// Legacy #/correo (mailbox.js): internal mail between colleagues of a hotel.
export default function MailPage() {
  return (
    <>
      <SectionTitle section="correo" />
      <Suspense>
        <SectionGate section="correo">
          <Mail />
        </SectionGate>
      </Suspense>
    </>
  );
}

async function Mail() {
  const t = await getTranslations("Mail");
  const workspace = await loadWorkspace();
  if (workspace.status !== "ok") return null;
  if (!workspace.access.length) return <p>{t("noHotel")}</p>;
  const hotels = workspace.access.map((a) => ({
    key: a.hotelKey,
    name: workspace.outlets.find((o) => o.hotelKey === a.hotelKey)?.hotel ?? a.hotelKey,
  }));
  return <Mailbox hotels={hotels} />;
}
