import { getTranslations } from "next-intl/server";
import Image from "next/image";
import { SiteHeader } from "@/components/site-header";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const t = await getTranslations("Login");
  const c = await getTranslations("Common");

  return (
    <>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="mx-auto grid max-w-content items-center gap-10 px-5 py-12 md:grid-cols-2">
        <div className="max-w-md">
          <h1 className="mb-3 text-heading">{c("signIn")}</h1>
          <p className="mb-8 text-muted">{t("intro")}</p>
          <LoginForm />
          {/* TODO(port): password recovery screen (legacy #/recuperar, recovery.js). */}
          <span className="text-sm font-semibold text-primary">{t("forgotPassword")}</span>
        </div>
        <Image
          src="/brand/photo/emplatado.webp"
          alt=""
          width={960}
          height={1200}
          priority
          className="hidden rounded-large object-cover md:block"
        />
      </main>
    </>
  );
}
