import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Icon } from "./icon";
import { LanguagePicker } from "./language-picker";

// Port of the legacy `.masthead`. The landing page uses the wider fluid
// `home-wrap` container and a slightly larger logo; other pages use `shell`.
export async function SiteHeader({ variant }: { variant: "home" | "shell" }) {
  const c = await getTranslations("Common");
  const l = await getTranslations("Landing");
  const home = variant === "home";

  // On the landing page the section links are plain anchors so the browser
  // scrolls and fires `hashchange` (used for the section motion).
  const sectionHref = (id: string) => (home ? `#${id}` : `/#${id}`);
  const navLink =
    "inline-flex min-h-11 items-center gap-[.65rem] text-[.92rem] font-semibold text-green no-underline hover:text-green-hover hover:underline hover:underline-offset-[.36em] max-620:hidden";

  return (
    <header className="border-b border-line">
      <div
        className={`flex items-center gap-[1.7rem] max-960:gap-x-[.8rem] max-900:gap-y-4 max-720:flex-wrap max-720:gap-y-2 max-720:py-[.8rem] max-420:gap-x-[.4rem] ${
          home
            ? "home-wrap min-h-[5.8rem] max-780:min-h-[4.8rem] max-620:min-h-[4.3rem]"
            : "shell min-h-[88px] max-720:min-h-[68px]"
        }`}
      >
        <Link
          href="/"
          aria-label={c("homeLabel")}
          className="inline-flex min-h-11 flex-none items-center"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- SVG logo, sized by CSS like the legacy site */}
          <img
            src="/brand/assets/logo/compi-logo-green.svg"
            alt="CompI"
            width={1226}
            height={327}
            className={`block h-auto ${
              home
                ? "w-[9.3rem] max-780:w-[7.7rem] max-620:w-[7.05rem]"
                : "w-[150px] max-720:w-[120px]"
            } max-420:w-[clamp(72px,19vw,96px)]`}
          />
        </Link>

        <nav
          aria-label={c("publicNav")}
          className="ms-auto flex items-center gap-[clamp(1.4rem,3.4vw,3.5rem)] max-780:gap-[1.1rem]"
        >
          <a href={sectionHref("proyecto")} className={navLink}>
            {l("navProject")}
          </a>
          <a href={sectionHref("herramientas")} className={navLink}>
            {l("navTools")}
          </a>
          <Link href="/acceso" className="btn-home max-420:px-[.55rem]">
            <span>{c("signIn")}</span>
            <Icon name="arrow" className="w-[1.05rem] rotate-[-40deg]" />
          </Link>
        </nav>

        <LanguagePicker />
      </div>
    </header>
  );
}
