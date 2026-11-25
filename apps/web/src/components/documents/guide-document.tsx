"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { brandRevision } from "@/app/actions/guides";
import { Icon } from "@/components/icon";

// react-pdf needs the browser: load it on the client only.
const PdfReader = dynamic(() => import("./pdf-reader"), { ssr: false });

type Guide = { hotelKey: string; outletKey: string; guideKey: string; title: string };
type Format = "pdf" | "docx";
const fileUrl = (g: Guide, fmt: Format, original = false) =>
  `/api/guides/${g.hotelKey}/${g.outletKey}/${g.guideKey}/files/${fmt}${original ? "?original=1" : ""}`;

class FileError extends Error {
  constructor(readonly status: number, readonly code?: string) {
    super(code ?? String(status));
  }
}

async function fetchDocument(g: Guide, fmt: Format, original = false) {
  const res = await fetch(fileUrl(g, fmt, original), { cache: "no-store" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new FileError(res.status, body?.error?.code);
  }
  const revision = res.headers.get("x-compi-brand-revision");
  return { blob: await res.blob(), revision: revision && /^\d+$/.test(revision) ? Number(revision) : null };
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Download button (legacy `download()`): re-branded file, or the original when offered. */
export function DownloadButton({
  guide, fmt, label, original = false, primary = false, toolbar = false, onUnsupported, onFailed,
}: {
  guide: Guide; fmt: Format; label: string; original?: boolean; primary?: boolean;
  /** In the document toolbar legacy draws a slightly narrower icon. */
  toolbar?: boolean;
  onUnsupported?: (fmt: Format) => void; onFailed?: (status: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={`download btn ${primary ? "btn-primary" : ""}`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { blob } = await fetchDocument(guide, fmt, original);
          save(blob, `${guide.title}.${fmt}`);
        } catch (error) {
          const e = error as FileError;
          if (e.code === "BRAND_TEMPLATE_UNSUPPORTED" && !original) onUnsupported?.(fmt);
          else onFailed?.(e.status ?? 0);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Icon name="download" className={toolbar ? "w-[1.15rem] flex-[0_0_1.15rem]" : ""} />
      {label}
    </button>
  );
}

/** Legacy "original document" panel shown when the brand cannot be applied. */
function OriginalPanel({ guide, fmt }: { guide: Guide; fmt: Format }) {
  const t = useTranslations("Archive");
  return (
    <div className="original-document">
      <p role="alert" className="alert-error">{t("templateUnsupported")}</p>
      <DownloadButton guide={guide} fmt={fmt} original label={fmt === "pdf" ? t("originalPdf") : t("originalWord")} />
    </div>
  );
}

/**
 * Published guide: download buttons and a PDF preview that follows the
 * hotel's brand (legacy `watchPdf`: re-checked every 30 s, on focus and when
 * the tab becomes visible).
 */
export function GuideDocument({ guide, onGone }: { guide: Guide; onGone?: () => void }) {
  const t = useTranslations("Archive");
  const [pdf, setPdf] = useState<Blob | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retry, setRetry] = useState(false);
  const [unsupported, setUnsupported] = useState<Set<Format>>(new Set());
  const revision = useRef<number | null>(null);
  const checking = useRef(false);

  const refresh = useCallback(
    async (initial = false) => {
      if (checking.current || (!initial && document.hidden)) return;
      checking.current = true;
      try {
        let current: number | null = null;
        if (!initial) {
          current = await brandRevision(guide.hotelKey);
          if (revision.current !== null && current === revision.current) return;
        }
        const result = await fetchDocument(guide, "pdf");
        revision.current = result.revision ?? current;
        setPdf(result.blob);
        setNotice(null);
        setRetry(false);
        setUnsupported((s) => {
          const next = new Set(s);
          next.delete("pdf");
          return next;
        });
      } catch (error) {
        const e = error as FileError;
        if (e.code === "BRAND_TEMPLATE_UNSUPPORTED") {
          setPdf(null);
          setUnsupported((s) => new Set(s).add("pdf"));
        } else if ([400, 401, 403, 404].includes(e.status)) {
          onGone?.();
        } else {
          setNotice(t("refreshFailed"));
          setRetry(true);
        }
      } finally {
        checking.current = false;
      }
    },
    [guide, onGone, t],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load of an external resource
    void refresh(true);
    const check = () => void refresh();
    const timer = setInterval(check, 30_000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [refresh]);

  useEffect(() => {
    if (!pdf) return;
    const url = URL.createObjectURL(pdf);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- object URL tied to the blob
    setPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pdf]);

  const markUnsupported = (fmt: Format) => setUnsupported((s) => new Set(s).add(fmt));

  return (
    <>
      <div className="toolbar mt-5 mb-4 flex flex-wrap items-center gap-[.6rem]">
        <DownloadButton guide={guide} fmt="pdf" primary toolbar label={t("downloadPdf")} onUnsupported={markUnsupported} />
        <DownloadButton guide={guide} fmt="docx" toolbar label={t("downloadWord")} onUnsupported={markUnsupported} />
        {pdfUrl && (
          <a className="download btn" href={pdfUrl} target="_blank" rel="noopener noreferrer">
            {t("openPdf")}
          </a>
        )}
      </div>
      {[...unsupported].map((fmt) => (
        <OriginalPanel key={fmt} guide={guide} fmt={fmt} />
      ))}
      {notice && <p role="status" className="alert-ok">{notice}</p>}
      {retry && (
        <button type="button" className="btn pdf-preview-retry mt-[.3rem] mb-[.8rem]" onClick={() => void refresh(true)}>
          {t("retry")}
        </button>
      )}
      <div className="pdf-preview">
        {pdf && (
          <PdfReader
            file={pdf}
            title={guide.title}
            onError={() => {
              setNotice(t("pdfFailed"));
              setRetry(true);
            }}
          />
        )}
      </div>
    </>
  );
}
