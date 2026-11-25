import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SignOutButton } from "@/components/sign-out-button";
import { SiteHeader } from "@/components/site-header";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("PasswordChange");
  return { title: t("metaTitle") };
}

// Reached from sign-in when GET /v1/session requires this step. The database
// keeps refusing the workspace until it is done, whatever the client does.
export default async function Page() {
  const t = await getTranslations("PasswordChange");
  return (
    <>
      <SiteHeader variant="shell" />
      <main id="main" tabIndex={-1} className="shell py-[clamp(2rem,5vw,4.25rem)] max-720:pt-[1.8rem] max-720:pb-12">
        <div className="w-[min(100%,26rem)] max-720:w-full max-720:max-w-[32rem]">
          <h1 className="mb-[1.05rem] text-[clamp(2.6rem,5.3vw,3.5rem)]">{t("title")}</h1>
          <p className="mb-[2.1rem] max-w-[38ch] text-[1.05rem] text-muted">{t("intro")}</p>
          {/* TODO(port): password change form (legacy password-change.js, compi_finish_password_change). */}
          <SignOutButton />
        </div>
      </main>
    </>
  );
}
