import { getTranslations } from "next-intl/server";
import { Icon } from "@/components/icon";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Link } from "@/i18n/navigation";
import { LandingMotion } from "./landing-motion";

// Public landing page. Port of legacy index.html + portada.css.
const twoColumns =
  "home-wrap grid grid-cols-[1fr_1.04fr] gap-[clamp(2rem,5.5vw,6.5rem)] max-780:gap-8 max-620:grid-cols-1";
const homeH2 =
  "m-0 text-[clamp(2.4rem,4.1vw,4.05rem)] leading-[1.05] font-[450] tracking-[-.037em]";
const photo = "m-0 overflow-hidden rounded-[2px] bg-ivory";
const photoImg = "block size-full object-cover";

export default async function LandingPage() {
  const t = await getTranslations("Landing");
  const c = await getTranslations("Common");

  const tools = [
    { title: t("platingTitle"), body: t("platingBody") },
    { title: t("recipesTitle"), body: t("recipesBody") },
    { title: t("mailTitle"), body: t("mailBody") },
  ];

  return (
    <>
      <SiteHeader variant="home" />
      <main id="main" tabIndex={-1} data-page="home" className="w-full">
        <section aria-labelledby="home-title" className="border-b border-line">
          <div
            className={`${twoColumns} items-center py-[clamp(1.75rem,3.1vw,3.35rem)] max-620:gap-[1.8rem] max-620:pt-[2.7rem] max-620:pb-6`}
          >
            <div className="pt-[1.3rem] pb-8 motion-safe:animate-home-enter max-620:p-0">
              <p className="kicker">{t("kicker")}</p>
              <h1
                id="home-title"
                className="m-0 text-[clamp(4.5rem,7.5vw,7.65rem)] leading-[.98] font-[450] tracking-[-.043em] text-green max-780:text-[clamp(3.7rem,8.2vw,5rem)] max-620:text-[clamp(3.75rem,14vw,5.25rem)]"
              >
                <span>{t("titleStart")}</span> <br />
                <span>{t("titleEnd")}</span>
              </h1>
              <p className="mt-[1.6rem] mb-0 max-w-[36ch] text-[clamp(1rem,1.35vw,1.23rem)] leading-[1.62] text-muted max-620:mt-4">
                {t("lead")}
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-x-[1.6rem] gap-y-[.7rem] max-780:mt-6 max-780:gap-x-4 max-780:gap-y-2 max-620:mt-[1.2rem] max-360:gap-x-[.85rem] max-360:gap-y-[.1rem]">
                <Link href="/acceso" className="btn-home">
                  <span>{c("enterPortal")}</span>
                  <Icon name="arrow" mirror />
                </Link>
                <a
                  href="#proyecto"
                  className="inline-flex min-h-11 items-center gap-[.65rem] text-[.92rem] font-semibold text-green no-underline hover:text-green-hover hover:underline hover:underline-offset-[.36em] max-360:text-[.86rem]"
                >
                  <bdi>{t("learnMore")}</bdi>
                  <span aria-hidden="true" className="inline-block text-[1.2rem]">↓</span>
                </a>
              </div>
            </div>
            <figure
              className={`${photo} h-[clamp(26rem,37.7vw,36rem)] motion-safe:animate-home-enter-photo max-780:h-[clamp(24rem,53vw,27rem)] max-620:aspect-[1.36] max-620:h-auto`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- sized by CSS like the legacy site */}
              <img
                src="/brand/photo/emplatado.webp"
                alt={t("heroAlt")}
                width={1122}
                height={1402}
                fetchPriority="high"
                className={`${photoImg} object-[50%_64%]`}
              />
            </figure>
          </div>
        </section>

        <section
          id="proyecto"
          aria-labelledby="project-title"
          tabIndex={-1}
          className={`${twoColumns} scroll-mt-4 items-start py-[clamp(3rem,6.5vw,6rem)] max-620:gap-5 max-620:py-12`}
        >
          <div data-reveal>
            <p className="kicker">{t("navProject")}</p>
            <h2 id="project-title" className={homeH2}>
              <span>{t("projectTitleStart")}</span> <br className="max-620:hidden" />
              <span>{t("projectTitleEnd")}</span>
            </h2>
          </div>
          <div data-reveal className="max-w-[53ch] pt-[.35rem]">
            {[t("projectBody1"), t("projectBody2")].map((text) => (
              <p
                key={text}
                className="mt-0 mb-[.9rem] text-[clamp(1rem,1.17vw,1.13rem)] leading-[1.78] text-ink last:mb-0"
              >
                {text}
              </p>
            ))}
          </div>
        </section>

        <section
          id="herramientas"
          aria-labelledby="tools-title"
          tabIndex={-1}
          className="scroll-mt-4 bg-green-soft py-[clamp(3rem,5.2vw,5.3rem)] max-620:pt-10 max-620:pb-12"
        >
          <div className={`${twoColumns} items-center`}>
            <figure
              data-reveal
              className={`${photo} h-[clamp(22rem,32vw,31rem)] max-620:aspect-[1.55] max-620:h-auto`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- sized by CSS like the legacy site */}
              <img
                src="/brand/photo/cuaderno-de-cocina.webp"
                alt={t("toolsAlt")}
                width={1200}
                height={800}
                loading="lazy"
                decoding="async"
                className={`${photoImg} object-[48%_50%]`}
              />
            </figure>
            <div data-reveal data-tools>
              <p className="kicker">{t("navTools")}</p>
              <h2 id="tools-title" className={`${homeH2} mb-[1.8rem]`}>
                {t("toolsTitle")}
              </h2>
              {tools.map((tool, i) => (
                <details
                  key={tool.title}
                  name="home-tools"
                  open={i === 0}
                  className="group border-t border-line-strong last:border-b"
                >
                  <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 py-4 font-display text-[clamp(1.28rem,1.9vw,1.65rem)] leading-[1.3] text-green after:font-sans after:text-[1.45rem]/none after:font-normal after:content-['+'] group-open:after:content-['−'] [&::-webkit-details-marker]:hidden">
                    {tool.title}
                  </summary>
                  <p className="mt-[-.2rem] mr-[1.65rem] mb-[1.1rem] ml-0 max-w-[47ch] leading-[1.65] text-ink">
                    {tool.body}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>
        <LandingMotion />
      </main>
      <SiteFooter />
    </>
  );
}
