import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthPage } from "@/components/auth/auth-page";
import { SignOutButton } from "@/components/sign-out-button";
import { VerifyForm } from "./verify-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Verification");
  return { title: t("metaTitle") };
}

// Port of legacy segundo-factor.js. The code now arrives by email (sent by the
// API at sign-in); the database keeps the workspace closed until it is entered.
export default async function VerificationPage() {
  const t = await getTranslations("Verification");
  return (
    <AuthPage>
      <h1 className="mb-[1.05rem] max-w-[12ch] text-[clamp(2.6rem,5.3vw,3.5rem)] max-720:max-w-none">{t("title")}</h1>
      <p className="mb-[2.1rem] max-w-[38ch] text-[1.05rem] text-muted max-720:mb-6">{t("intro")}</p>
      <VerifyForm />
      <SignOutButton label={t("back")} className="btn mt-4" icon={false} />
    </AuthPage>
  );
}
