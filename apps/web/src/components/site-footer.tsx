import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Icon } from "./icon";

// Port of the legacy `.home-footer`.
export async function SiteFooter() {
  const c = await getTranslations("Common");

  return (
    <footer className="bg-green-active py-8 text-ivory [&_:focus-visible]:outline-white">
      <div className="home-wrap flex items-center gap-[1.8rem] max-620:flex-wrap max-620:gap-x-5 max-620:gap-y-[.45rem]">
        <Link
          href="/"
          aria-label={c("homePageLabel")}
          className="inline-flex min-h-11 items-center"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- SVG logo */}
          <img
            src="/brand/assets/logo/compi-logo-ivory.svg"
            alt="CompI"
            width={1226}
            height={327}
            className="h-auto w-[7.4rem]"
          />
        </Link>
        <span className="text-[.84rem] max-620:order-3 max-620:basis-full">
          {c("testEnvironment")}
        </span>
        <Link
          href="/acceso"
          className="ms-auto inline-flex min-h-11 items-center gap-[.65rem] text-[.92rem] font-semibold text-ivory no-underline hover:text-ivory hover:underline hover:underline-offset-[.36em]"
        >
          <span>{c("teamAccess")}</span>
          <Icon name="arrow" mirror />
        </Link>
      </div>
    </footer>
  );
}
