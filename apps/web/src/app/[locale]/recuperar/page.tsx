import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthPage } from "@/components/auth/auth-page";
import { RecoverForm } from "./recover-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Recovery");
  return { title: t("metaTitle") };
}

// Port of legacy recovery.js (#/recuperar): new password with a personal code.
export default async function RecoveryPage() {
  const t = await getTranslations("Recovery");
  return (
    <AuthPage>
      <h1 className="mb-[1.05rem] max-w-[12ch] text-[clamp(2.6rem,5.3vw,3.5rem)] max-720:max-w-none">{t("title")}</h1>
      <p className="mb-[2.1rem] max-w-[38ch] text-[1.05rem] text-muted max-720:mb-6">{t("intro")}</p>
      <RecoverForm />
    </AuthPage>
  );
}
