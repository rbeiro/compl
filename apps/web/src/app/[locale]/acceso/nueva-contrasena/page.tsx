import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthPage } from "@/components/auth/auth-page";
import { PasswordForm } from "./password-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("PasswordChange");
  return { title: t("metaTitle") };
}

// Port of legacy password-change.js: accounts created with a temporary password.
export default async function PasswordChangePage() {
  const t = await getTranslations("PasswordChange");
  return (
    <AuthPage>
      <h1 className="mb-[1.05rem] max-w-[12ch] text-[clamp(2.6rem,5.3vw,3.5rem)] max-720:max-w-none">{t("title")}</h1>
      <p className="mb-[2.1rem] max-w-[38ch] text-[1.05rem] text-muted max-720:mb-6">{t("intro")}</p>
      <PasswordForm />
    </AuthPage>
  );
}
