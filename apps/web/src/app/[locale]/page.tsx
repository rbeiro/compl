import { getTranslations } from "next-intl/server";
import Image from "next/image";
import { buttonClass } from "@/components/button";
import { Icon } from "@/components/icon";
import { SiteHeader } from "@/components/site-header";
import { Link } from "@/i18n/navigation";

// Public landing page. Port of the legacy index.html landing section.
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
      <SiteHeader
        nav={
          <nav aria-label={c("publicNav")} className="flex items-center gap-5 text-sm font-medium">
            <a href="#proyecto" className="hover:text-primary">{t("navProject")}</a>
            <a href="#herramientas" className="hover:text-primary">{t("navTools")}</a>
            <Link href="/acceso" className={buttonClass}>
              {c("signIn")} <Icon name="arrow" />
            </Link>
          </nav>
        }
      />
      <main id="main" tabIndex={-1}>
        <section aria-labelledby="home-title" className="mx-auto grid max-w-content items-center gap-10 px-5 py-16 md:grid-cols-2">
          <div>
            <p className="mb-4 text-sm font-semibold tracking-wide text-primary uppercase">{t("kicker")}</p>
            <h1 id="home-title" className="mb-6 text-display">
              {t("titleStart")} <br />
              {t("titleEnd")}
            </h1>
            <p className="mb-8 max-w-prose text-lg text-muted">{t("lead")}</p>
            <div className="flex flex-wrap items-center gap-6">
              <Link href="/acceso" className={buttonClass}>
                {c("enterPortal")} <Icon name="arrow" />
              </Link>
              <a href="#proyecto" className="font-semibold text-primary underline-offset-4 hover:underline">
                <bdi>{t("learnMore")}</bdi> <span aria-hidden="true">↓</span>
              </a>
            </div>
          </div>
          <Image
            src="/brand/photo/emplatado.webp"
            alt={t("heroAlt")}
            width={1122}
            height={1402}
            priority
            className="rounded-large object-cover"
          />
        </section>

        <section id="proyecto" aria-labelledby="project-title" tabIndex={-1} className="mx-auto grid max-w-content gap-8 px-5 py-16 md:grid-cols-2">
          <h2 id="project-title" className="text-heading">
            {t("projectTitleStart")} <br className="hidden md:block" />
            {t("projectTitleEnd")}
          </h2>
          <div className="space-y-4 text-muted">
            <p>{t("projectBody1")}</p>
            <p>{t("projectBody2")}</p>
          </div>
        </section>

        <section id="herramientas" aria-labelledby="tools-title" tabIndex={-1} className="bg-ivory/40">
          <div className="mx-auto grid max-w-content items-center gap-10 px-5 py-16 md:grid-cols-2">
            <Image
              src="/brand/photo/cuaderno-de-cocina.webp"
              alt={t("toolsAlt")}
              width={1200}
              height={800}
              className="rounded-large object-cover"
            />
            <div>
              <h2 id="tools-title" className="mb-6 text-heading">{t("toolsTitle")}</h2>
              {tools.map((tool, i) => (
                <details key={tool.title} name="home-tools" open={i === 0} className="border-b border-line py-4">
                  <summary className="cursor-pointer font-semibold">{tool.title}</summary>
                  <p className="mt-2 text-muted">{tool.body}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-green text-ivory">
        <div className="mx-auto flex max-w-content flex-wrap items-center justify-between gap-4 px-5 py-8">
          <Link href="/" aria-label={c("homePageLabel")}>
            <Image src="/brand/assets/logo/compi-logo-ivory.svg" alt="CompI" width={1226} height={327} className="h-8 w-auto" />
          </Link>
          <Link href="/acceso" className="inline-flex items-center gap-2 font-semibold">
            {c("teamAccess")} <Icon name="arrow" />
          </Link>
        </div>
      </footer>
    </>
  );
}
