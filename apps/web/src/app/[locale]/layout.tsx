import "../globals.css";
import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { locale as rootLocale } from "next/root-params";
import { routing, rtlLocales } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Meta");
  return {
    title: t("title"),
    description: t("description"),
    applicationName: "CompI",
    robots: { index: false, follow: false },
    icons: {
      icon: [
        { url: "/brand/assets/favicon/favicon.svg", type: "image/svg+xml" },
        { url: "/brand/assets/favicon/favicon.ico" },
      ],
      apple: "/brand/assets/app/apple-touch-icon.png",
    },
  };
}

export default async function LocaleLayout({ children }: LayoutProps<"/[locale]">) {
  const locale = await rootLocale();
  if (!hasLocale(routing.locales, locale)) notFound();
  const t = await getTranslations("Common");

  return (
    <html lang={locale} dir={rtlLocales.has(locale) ? "rtl" : "ltr"}>
      <body className="compi">
        <a
          href="#main"
          className="fixed start-4 top-2 z-[5] -translate-y-[160%] rounded-control bg-white px-[1.1rem] py-[.7rem] focus:translate-y-0"
        >
          {t("skipToContent")}
        </a>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
