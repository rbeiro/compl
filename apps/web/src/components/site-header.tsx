import { getTranslations } from "next-intl/server";
import Image from "next/image";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { LanguagePicker } from "./language-picker";

export async function SiteHeader({ nav }: { nav?: ReactNode }) {
  const t = await getTranslations("Common");
  return (
    <header className="border-b border-line bg-background">
      <div className="mx-auto flex max-w-content flex-wrap items-center gap-4 px-5 py-3">
        <Link href="/" aria-label={t("homeLabel")} className="me-auto">
          <Image
            src="/brand/assets/logo/compi-logo-green.svg"
            alt="CompI"
            width={1226}
            height={327}
            priority
            className="h-8 w-auto"
          />
        </Link>
        {nav}
        <LanguagePicker label="Language / Idioma" />
      </div>
    </header>
  );
}
