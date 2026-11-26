import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { GuideDocument } from "@/components/documents/guide-document";
import { Icon } from "@/components/icon";
import { SectionGate, sectionMetadata } from "@/components/workspace/section";
import { Link } from "@/i18n/navigation";
import { loadAllGuides, loadWorkspace } from "@/lib/workspace";
import { ArchiveDownload } from "./archive-download";
import { FolderControls, GuideControls } from "./archive-controls";

export const generateMetadata = () => sectionMetadata("archivo");

// Port of the legacy document archive (portal.js, #/empresa/<hotel>/<outlet>/Plating Guides/<guide>).

const route = (parts: string[]) => `/empresa/${parts.map(encodeURIComponent).join("/")}`.replace(/\/$/, "");
const h1 = "m-0 mb-[1.1rem] text-[clamp(2rem,2.9vw,2.7rem)] text-(--ws-deep)";
const statusCls = (draft: boolean) =>
  `guide-status inline-flex items-center gap-[.45rem] justify-self-start text-sm leading-normal font-medium before:size-2 before:rounded-full before:content-[''] ${
    draft ? "draft text-warning before:border-[1.5px] before:border-current before:bg-transparent" : "text-green before:bg-current"
  }`;

/** Legacy folderCount(): plural forms per language; Arabic keeps its own wording. */
function folderCount(count: number, outlets: boolean, locale: string, t: (k: string, v: { count: string }) => string) {
  const form = new Intl.PluralRules(locale).select(count);
  const number = new Intl.NumberFormat(locale).format(count);
  if (locale === "ar") {
    const units: Record<string, string> = outlets
      ? { zero: "لا توجد منافذ", one: "منفذ واحد", two: "منفذان", few: "{count} منافذ", many: "{count} منفذًا", other: "{count} منفذ" }
      : { zero: "لا توجد بطاقات", one: "بطاقة واحدة", two: "بطاقتان", few: "{count} بطاقات", many: "{count} بطاقةً", other: "{count} بطاقة" };
    return units[form]!.replace("{count}", number);
  }
  const key = outlets ? (form === "one" ? "outletOne" : "outletMany") : form === "one" ? "sheetOne" : "sheetMany";
  return t(key, { count: number });
}

export default function ArchivePage({ params }: PageProps<"/[locale]/empresa/[[...path]]">) {
  return (
    <Suspense>
      <SectionGate section="archivo">
        <Archive params={params} />
      </SectionGate>
    </Suspense>
  );
}

async function Archive({ params }: { params: PageProps<"/[locale]/empresa/[[...path]]">["params"] }) {
  const t = await getTranslations("Archive");
  const locale = await getLocale();
  const workspace = await loadWorkspace();
  if (workspace.status !== "ok") return null;
  const { access, outlets } = workspace;
  const parts = ((await params).path ?? []).map(decodeURIComponent);

  const unavailable = (text = t("unavailable")) => (
    <>
      <Breadcrumbs parts={[]} t={t} />
      <h1 className={h1}>{text}</h1>
      <Link href="/empresa">{t("backToArchive")}</Link>
    </>
  );
  if (parts.length > 4 || parts.some((p) => !p || p.includes("/") || p === "." || p === "..")) return unavailable();

  const guides = await loadAllGuides();
  const folder = (r: { hotel: string; outlet: string }) => [r.hotel, r.outlet, "Plating Guides"];
  const rows = guides.filter((r) => parts.slice(0, 3).every((p, i) => folder(r)[i] === p));
  const available = outlets.filter((o) => parts.slice(0, 3).every((p, i) => folder(o)[i] === p));
  const company = access.find((a) => a.hotelKey === parts[0] && !outlets.some((o) => o.hotelKey === a.hotelKey));
  const ctx = available[0] ?? (company ? { hotelKey: company.hotelKey, hotel: parts[0]!, outletKey: "" } : null);
  if (parts.length && !available.length && !(company && parts.length === 1)) return unavailable();
  const editors = new Set(access.filter((a) => a.accessRank === 1 || a.accessRank === 2).map((a) => a.hotelKey));
  const rankIn = (hotelKey: string) => access.find((a) => a.hotelKey === hotelKey)?.accessRank ?? 3;
  const controlsCtx = ctx && { hotelKey: ctx.hotelKey, outletKey: ctx.outletKey, hotel: ctx.hotel, outlet: "outlet" in ctx ? ctx.outlet : undefined };

  if (parts.length < 3) {
    const names = new Set(available.map((r) => folder(r)[parts.length]!));
    if (!parts.length) for (const a of access) if (a.accessRank === 1 && !outlets.some((o) => o.hotelKey === a.hotelKey)) names.add(a.hotelKey);
    const icon = ["hotel", "folder", "book"][parts.length]!;
    return (
      <>
        {parts.length > 0 && <Breadcrumbs parts={parts} t={t} />}
        <h1 className={h1} translate={parts.length ? "no" : undefined} dir={parts.length ? "auto" : undefined}>
          {parts.at(-1) ?? t("title")}
        </h1>
        {!parts.length && <p className="intro mb-4 max-w-[47ch] text-[1.05rem] text-muted">{t("intro")}</p>}
        {names.size ? (
          <div className="folders my-[1.8rem] grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-4 max-720:mt-[1.3rem]">
            {[...names].map((name) => {
              const count = parts.length === 0
                ? new Set(available.filter((r) => r.hotel === name).map((r) => r.outletKey)).size
                : rows.filter((r) => parts.length === 2 || r.outlet === name).length;
              return (
                <Link
                  key={name}
                  href={route([...parts, name])}
                  aria-label={parts.length === 2 ? t("guidesFolder") : name}
                  className="folder flex min-h-30 items-center gap-4 rounded-panel border border-line bg-white p-[1.35rem] no-underline hover:border-green hover:bg-green-soft max-720:min-h-24"
                >
                  <span className="folder-icon grid size-[2.8rem] flex-none place-items-center rounded-control bg-green-soft text-green">
                    <Icon name={icon} className="size-[1.45rem]" />
                  </span>
                  <span className="folder-copy grid min-w-0 gap-[.35rem]">
                    <strong className="font-display text-[1.45rem]/[1.12] font-medium tracking-[-.035em] text-green [overflow-wrap:anywhere]">
                      {parts.length === 2 ? t("guidesFolder") : name}
                    </strong>
                    <small className="text-muted [font-size:smaller]">{folderCount(count, parts.length === 0, locale, t)}</small>
                  </span>
                  <Icon name="arrow" mirror className="ms-auto w-4" />
                </Link>
              );
            })}
          </div>
        ) : (
          <p>{t("noDocuments")}</p>
        )}
        {controlsCtx && parts.length > 0 && <FolderControls key={parts.join("/")} level={parts.length} ctx={controlsCtx} rank={rankIn(controlsCtx.hotelKey)} parts={parts} />}
      </>
    );
  }

  if (parts.length === 3 && ctx) {
    return (
      <>
        <Breadcrumbs parts={parts} t={t} />
        <h1 className={h1}>{t("guidesFolder")}</h1>
        {editors.has(ctx.hotelKey) && (
          <Link href={`/generar/${encodeURIComponent(ctx.hotelKey)}/${encodeURIComponent(ctx.outletKey)}`} className="generate-here btn btn-primary mb-[1.2rem]">
            {t("generate")}
          </Link>
        )}
        {rows.length ? (
          <div className="rows rounded-panel border border-line bg-white">
            {rows.map((row) => {
              const draft = row.state === "draft";
              const label = draft ? (editors.has(row.hotelKey) ? t("completeDraft") : t("draftStatus")) : t("viewSheet");
              const href = draft ? route([...parts, row.guideKey]) : `/plating/${[row.hotelKey, row.outletKey, row.guideKey].map(encodeURIComponent).join("/")}`;
              return (
                <div key={row.guideKey} className="row flex items-center gap-4 px-[1.2rem] py-[1.05rem] [&+&]:border-t [&+&]:border-line max-720:flex-wrap max-720:gap-[.65rem]">
                  <span className="folder-icon grid size-[2.8rem] flex-none place-items-center rounded-control bg-green-soft text-green">
                    <Icon name="file" className="size-[1.45rem]" />
                  </span>
                  <div className="row-copy grid min-w-0 gap-[.35rem] max-720:flex-1">
                    <strong className="dish text-[1.03rem] [overflow-wrap:anywhere]" translate="no" dir="auto">
                      {row.title}
                    </strong>
                    <span className={statusCls(draft)}>{draft ? t("draft") : t("published")}</span>
                  </div>
                  <div className="formats ms-auto flex flex-wrap items-center gap-[.6rem] max-720:m-0 max-720:w-full">
                    <Link href={href} className="download btn btn-primary">
                      {label}
                    </Link>
                    {!draft && <ArchiveDownload guide={row} />}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p>{t("emptyFolder")}</p>
        )}
        {controlsCtx && <FolderControls key={parts.join("/")} level={3} ctx={controlsCtx} rank={rankIn(controlsCtx.hotelKey)} parts={parts} />}
      </>
    );
  }

  const row = rows.find((r) => r.guideKey === parts[3]);
  if (!row) return unavailable((await getTranslations("Plating"))("unavailable"));
  const draft = row.state === "draft";
  return (
    <>
      <Breadcrumbs parts={parts.slice(0, 3)} t={t} />
      <h1 className={h1} translate="no" dir="auto">
        {row.title}
      </h1>
      <span className={statusCls(draft)}>{draft ? t("draft") : t("published")}</span>
      <GuideControls key={parts.join("/")} row={row} rank={rankIn(row.hotelKey)} parts={parts} />
      {draft ? (
        editors.has(row.hotelKey) && row.hasSource && (
          <p>
            <Link href={`/generar/${[row.hotelKey, row.outletKey, row.guideKey].map(encodeURIComponent).join("/")}`} className="btn btn-primary">
              {t("editAgain")}
            </Link>
          </p>
        )
      ) : (
        <GuideDocument guide={row} />
      )}
    </>
  );
}

function Breadcrumbs({ parts, t }: { parts: string[]; t: (key: string) => string }) {
  return (
    <nav aria-label={t("breadcrumbs")} className="mb-5 flex flex-wrap items-center gap-2 text-[.9rem] text-muted [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_a]:[overflow-wrap:anywhere]">
      <Link href="/empresa">{t("title")}</Link>
      {parts.map((p, i) => (
        <span key={i} className="contents">
          {" / "}
          <Link href={route(parts.slice(0, i + 1))}>{i === 2 ? t("guidesFolder") : p}</Link>
        </span>
      ))}
    </nav>
  );
}
