"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { DownloadButton } from "@/components/documents/guide-document";

/** "Download Word" in the folder list; offers the original file when the brand cannot be applied. */
export function ArchiveDownload({ guide }: { guide: { hotelKey: string; outletKey: string; guideKey: string; title: string } }) {
  const t = useTranslations("Archive");
  const [unsupported, setUnsupported] = useState(false);
  return (
    <>
      <DownloadButton guide={guide} fmt="docx" label={t("downloadWord")} onUnsupported={() => setUnsupported(true)} />
      {unsupported && (
        <div className="original-document basis-full">
          <p role="alert" className="alert-error">{t("templateUnsupported")}</p>
          <DownloadButton guide={guide} fmt="docx" original label={t("originalWord")} />
        </div>
      )}
    </>
  );
}
