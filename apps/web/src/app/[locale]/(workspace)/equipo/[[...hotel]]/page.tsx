import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { SectionGate, sectionMetadata, SectionTitle } from "@/components/workspace/section";
import { Link } from "@/i18n/navigation";
import { loadWorkspace } from "@/lib/workspace";
import { Team } from "./_components/team";

export const generateMetadata = () => sectionMetadata("equipo");

// Legacy #/equipo[/hotel] (portal.js + management.js `panel`): the executive
// chef's staff panel, one hotel at a time.
export default function TeamPage({ params }: PageProps<"/[locale]/equipo/[[...hotel]]">) {
  return (
    <>
      <SectionTitle section="equipo" />
      <Suspense>
        <SectionGate section="equipo">
          <Content params={params} />
        </SectionGate>
      </Suspense>
    </>
  );
}

async function Content({ params }: { params: PageProps<"/[locale]/equipo/[[...hotel]]">["params"] }) {
  const t = await getTranslations("Team");
  const locale = await getLocale();
  const workspace = await loadWorkspace();
  if (workspace.status !== "ok") return null;
  const admins = workspace.access.filter((a) => a.accessRank === 1).map((a) => a.hotelKey);
  if (!admins.length) return <p>{t("noAccess")}</p>;
  const { hotel: segments } = await params;
  const selected = segments?.length ? decodeURIComponent(segments[0]!) : admins[0]!;
  if (segments && segments.length > 1) return <p>{t("hotelUnavailable")}</p>;
  if (!admins.includes(selected)) return <p>{t("hotelUnavailable")}</p>;
  const hotelName = (key: string) => workspace.outlets.find((o) => o.hotelKey === key)?.hotel ?? key;
  return (
    <>
      {admins.length > 1 && (
        <nav>
          {admins.map((key) => (
            <Link key={key} href={`/equipo/${encodeURIComponent(key)}`}>
              {hotelName(key)}
            </Link>
          ))}
        </nav>
      )}
      <h2>{hotelName(selected)}</h2>
      <Team key={selected} hotel={selected} locale={locale} />
    </>
  );
}
