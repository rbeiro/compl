import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { loadWorkspace, type Section } from "@/lib/workspace";

const titleKey: Record<Section, string> = {
  inicio: "home", horarios: "schedules", equipo: "team", recetas: "recipes", escandallos: "costs",
  plating: "plating", generar: "generate", archivo: "archiveTitle", correo: "mail", seguridad: "securityTitle",
};

/** "{section} · Portal CompI" document title, as in the legacy portal. */
export async function sectionMetadata(section: Section): Promise<Metadata> {
  const t = await getTranslations("Workspace");
  return { title: t("pageTitle", { section: t(titleKey[section]) }) };
}

/** Section heading (`.ws-main-content > h1`). */
export async function SectionTitle({ section }: { section: Section }) {
  const t = await getTranslations("Workspace");
  return (
    <h1 className="m-0 mb-[1.1rem] text-[clamp(2rem,2.9vw,2.7rem)] text-(--ws-deep)">{t(titleKey[section])}</h1>
  );
}

/** Renders `children` only when the section is available to this user (legacy "Acceso restringido"). */
export async function SectionGate({ section, children }: { section: Section; children: ReactNode }) {
  const t = await getTranslations("Workspace");
  const workspace = await loadWorkspace();
  if (workspace.status !== "ok") return null;
  if (!workspace.access.length) return <p>{t("noHotel")}</p>;
  if (!workspace.links[section]) return <p>{t("restricted")}</p>;
  return children;
}
