import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { sectionMetadata } from "@/components/workspace/section";
import { WsIcon } from "@/components/workspace/ws-icon";
import { Link } from "@/i18n/navigation";
import { guideHref, loadAllGuides, loadWorkspace } from "@/lib/workspace";
import { Metrics } from "./metrics";
import { Today } from "./today";

export const generateMetadata = () => sectionMetadata("inicio");

// Port of legacy workspace-shell.js `renderInicio` (#/portal).
export default function HomePage() {
  return (
    <Suspense>
      <Home />
    </Suspense>
  );
}

const eyebrow = "text-[.65rem]/[1.5] font-[650] tracking-[.13em] text-(--ws-muted) uppercase";
const inlineLink =
  "inline-flex min-h-11 flex-row-reverse items-center justify-center gap-[.48rem] text-[.8rem]/[1.4] font-[650] text-green no-underline hover:underline hover:underline-offset-[.2em]";
const card = "min-w-0 rounded-[12px] border border-(--ws-line) bg-(--ws-paper)";

async function Home() {
  const t = await getTranslations("Home");
  const c = await getTranslations("Common");
  const workspace = await loadWorkspace();
  if (workspace.status !== "ok") return null;
  const { links, access, outlets, hotelLabel } = workspace;
  const guides = access.length ? await loadAllGuides() : [];
  const number = new Intl.NumberFormat(await getLocale());
  const ready = guides.filter((g) => g.state === "ready").length;
  const drafts = guides.filter((g) => g.state === "draft").length;

  const metric = (title: string, value: number, icon: string, href: string | null) => {
    const body = (
      <>
        <div className="ws-metric-top flex items-center justify-between gap-[.3rem] text-[.76rem] text-(--ws-muted)">
          <span>{title}</span>
          <WsIcon name={icon} className="size-4 text-[#7d8777]" />
        </div>
        <strong className="mt-[.65rem] mr-[1.2rem] block font-display text-[2.15rem]/[1.08] font-normal tracking-[-.04em] text-(--ws-deep) tabular-nums max-580:text-[1.85rem]">
          {number.format(value)}
        </strong>
      </>
    );
    const cls = `ws-metric ${card} relative block p-[1.05rem_1.13rem] no-underline transition-[transform,border-color] duration-(--ws-duration) ease-(--ws-ease) max-580:p-[.86rem]`;
    return href ? (
      <Link key={title} href={href} className={`${cls} text-green hover:-translate-y-0.5 hover:border-[#a3b59e] hover:text-green-hover motion-reduce:hover:translate-y-0`}>
        {body}
        <WsIcon name="arrow" className="absolute end-4 bottom-4 size-[.91rem] text-[#74836f] rtl:-scale-x-100" />
      </Link>
    ) : (
      <article key={title} className={`${cls} text-ink`}>
        {body}
      </article>
    );
  };

  return (
    <div className="ws-overview">
      <section className="ws-welcome mb-6 grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-[clamp(1.3rem,3.4vw,3rem)] max-960:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] max-960:gap-4 max-580:grid-cols-1 max-580:gap-[1.1rem]">
        <div className="ws-intro py-[.2rem]">
          <Today className={`ws-today ${eyebrow} mb-[.68rem] flex items-center gap-[.55rem] before:size-[.38rem] before:rounded-full before:bg-green before:content-['']`} />
          <h1 className="m-0 mb-[.65rem] max-w-[10.2ch] font-display text-[clamp(2.65rem,3.85vw,3.6rem)]/[1.02] font-medium tracking-[-.047em] text-balance text-(--ws-deep) max-580:text-[2.65rem]">
            {t("title")}
          </h1>
          <p className="m-0 text-[.91rem] leading-[1.65] text-(--ws-muted)">{t("intro")}</p>
          {(links.generar || links.recetas) && (
            <div className="ws-welcome-actions mt-4 flex flex-wrap items-center gap-x-4 gap-y-[.7rem]">
              {links.generar && (
                <Link href={links.generar} className="inline-flex min-h-11 items-center justify-center gap-[.48rem] rounded-[8px] bg-green px-4 py-2 text-[.8rem]/[1.4] font-[650] !text-white no-underline hover:bg-(--ws-deep)">
                  <WsIcon name="plus" className="size-[.98rem]" />
                  <span>{t("createSheet")}</span>
                </Link>
              )}
              {links.recetas && (
                <Link href={links.recetas} className={inlineLink}>
                  <WsIcon name="arrow" className="size-[.98rem] rtl:-scale-x-100" />
                  <span>{t("viewRecipes")}</span>
                </Link>
              )}
            </div>
          )}
        </div>
        <article className="ws-hotel-card flex min-h-[213px] flex-col justify-between rounded-[12px] bg-green px-[1.6rem] py-[1.35rem] text-white max-580:min-h-[163px] max-580:px-5 max-580:py-4">
          <div className="flex items-center justify-between gap-[.7rem]">
            <span className={`${eyebrow} tracking-[.15em] !text-[#eee4d1]`}>{t("yourSpace")}</span>
            <WsIcon name="sun" className="size-8 rounded-full border border-[#e4d3ba50] p-[.35rem] text-[#eee4d1]" />
          </div>
          <h2 className="my-4 font-display text-[clamp(1.7rem,2.4vw,2.3rem)]/[1.15] font-normal tracking-[-.025em] text-[#fffefa] max-580:my-[.6rem]">
            {hotelLabel || c("myWorkspace")}
          </h2>
          <div className="flex flex-wrap items-center justify-between gap-[.7rem] border-t border-[#ffffff36] pt-[.4rem] text-[.78rem] text-[#eee4d1]">
            <span>{t(outlets.length === 1 ? "outletOne" : "outletMany", { count: number.format(outlets.length) })}</span>
            {links.horarios && (
              <Link href={links.horarios} className={`${inlineLink} !text-[#fffefa]`}>
                <WsIcon name="arrow" className="size-[.98rem] rtl:-scale-x-100" />
                <span>{t("viewSchedules")}</span>
              </Link>
            )}
          </div>
        </article>
      </section>

      {!access.length ? (
        <p className="text-[.78rem] leading-[1.55] text-(--ws-muted)">{(await getTranslations("Workspace"))("noHotel")}</p>
      ) : (
        <>
          <Metrics label={t("summary")}>
            {metric(t("hotels"), new Set(access.map((a) => a.hotelKey)).size, "location", links.archivo)}
            {metric(t("outlets"), outlets.length, "folder", links.plating)}
            {metric(t("sheets"), guides.length, "book", links.recetas)}
            {metric(t("drafts"), drafts, "file", links.plating)}
          </Metrics>
          <div className="ws-panels grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-5 max-960:grid-cols-1">
            <section className={`ws-panel ${card} px-[1.3rem] pt-[1.1rem] pb-[1.2rem] max-580:p-4`}>
              <div className="ws-panel-head mb-[.6rem] flex flex-wrap items-center justify-between gap-[.7rem]">
                <h2 className="m-0 font-display text-[clamp(1.35rem,1.85vw,1.65rem)]/[1.25] font-[450] text-ink">{t("inRecipes")}</h2>
                {links.recetas && (
                  <Link href={links.recetas} className={inlineLink}>
                    <WsIcon name="arrow" className="size-[.98rem] rtl:-scale-x-100" />
                    <span>{t("viewRecipes")}</span>
                  </Link>
                )}
              </div>
              {!guides.length ? (
                <p className="text-[.78rem] leading-[1.55] text-(--ws-muted)">{t("noDocuments")}</p>
              ) : (
                <ul className="m-0 list-none p-0 [&>li+li]:border-t [&>li+li]:border-(--ws-line)">
                  {guides.slice(0, 4).map((g) => (
                    <li key={`${g.hotelKey}/${g.outletKey}/${g.guideKey}`}>
                      <Link href={guideHref(g)} className="ws-guide-link group flex min-h-14 items-center gap-[.8rem] py-[.48rem] text-green no-underline">
                        <span className="grid size-[2.3rem] flex-none place-items-center rounded-[8px] border border-[#d7e0d4] bg-green-soft text-green">
                          <WsIcon name="book" className="size-[1.06rem]" />
                        </span>
                        <span className="grid min-w-0">
                          <strong translate="no" className="text-[.86rem] font-[650] [overflow-wrap:anywhere] group-hover:underline group-hover:underline-offset-[.2em]">
                            {g.title}
                          </strong>
                          <small className="text-[.78rem] leading-[1.55] text-(--ws-muted)">{[g.hotel, g.outlet].filter(Boolean).join(" · ")}</small>
                        </span>
                        <WsIcon name="arrow" className="ms-auto size-[.95rem] rtl:-scale-x-100" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className={`ws-panel ${card} px-[1.3rem] pt-[1.1rem] pb-[1.2rem] max-580:p-4`}>
              <div className="ws-panel-head mb-[.6rem] flex flex-wrap items-center justify-between gap-[.7rem]">
                <h2 className="m-0 font-display text-[clamp(1.35rem,1.85vw,1.65rem)]/[1.25] font-[450] text-ink">{t("sheetState")}</h2>
              </div>
              <dl className="ws-state-list m-0 mt-4 grid gap-3">
                {(
                  [
                    [t("published"), ready, "bg-green"],
                    [t("drafts"), drafts, "bg-taupe"],
                  ] as const
                ).map(([label, value, fill]) => (
                  <div key={label} className="ws-state-row relative pb-[.65rem]">
                    <dt className="float-start text-[.83rem]/[1.5] font-[550] text-(--ws-muted)">{label}</dt>
                    <dd className="m-0 text-end text-base/[1.3] font-[550]">
                      {number.format(value)}
                      <div aria-hidden="true" className="clear-both mt-[.45rem] h-[.42rem] overflow-hidden rounded-full bg-[#efede6]">
                        <span className={`block h-full rounded-[inherit] ${fill}`} style={{ width: `${guides.length ? (100 * value) / guides.length : 0}%` }} />
                      </div>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
