import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SiteHeader } from "@/components/site-header";
import { Link } from "@/i18n/navigation";
import { AuthContent } from "@/components/auth/auth-content";
import { LoginForm } from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Login");
  return { title: t("metaTitle") };
}

// Port of the legacy `#auth-template` (index.html) and `.auth-layout` (portal.css).
export default async function LoginPage() {
  const t = await getTranslations("Login");
  const c = await getTranslations("Common");

  return (
    <>
      <SiteHeader variant="shell" />
      <main
        id="main"
        tabIndex={-1}
        className="shell py-[clamp(2rem,5vw,4.25rem)] max-720:pt-[1.8rem] max-720:pb-12"
      >
        <div className="grid grid-cols-[minmax(0,.92fr)_minmax(0,1.08fr)] items-center gap-[clamp(2rem,7.2vw,6.5rem)] max-900:gap-[2.2rem] max-720:flex max-720:flex-col max-720:items-stretch max-720:gap-8">
          <AuthContent>
            <h1 className="mb-[1.05rem] max-w-[12ch] text-[clamp(2.6rem,5.3vw,3.5rem)] max-720:max-w-none">
              {c("signIn")}
            </h1>
            <p className="mb-[2.1rem] max-w-[38ch] text-[1.05rem] text-muted max-720:mb-6">
              {t("intro")}
            </p>
            <LoginForm />
            <Link href="/recuperar" className="mt-[.8rem] inline-flex min-h-11 items-center">
              {t("forgotPassword")}
            </Link>
          </AuthContent>
          <div aria-hidden="true" className="overflow-hidden rounded-large bg-ivory">
            {/* eslint-disable-next-line @next/next/no-img-element -- sized by CSS like the legacy site */}
            <img
              src="/brand/photo/emplatado.webp"
              alt=""
              width={960}
              height={1200}
              fetchPriority="high"
              className="block h-[clamp(440px,59vh,640px)] w-full object-cover object-[50%_54%] max-720:h-[clamp(175px,55vw,300px)] max-720:object-[50%_63%]"
            />
          </div>
        </div>
      </main>
    </>
  );
}
