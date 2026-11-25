"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import { sequence } from "@/lib/motion";
import styles from "./pdf.module.css";

// Worker and assets from our own origin (see scripts/copy-pdf-assets.mjs).
pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
const options = {
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  wasmUrl: "/pdfjs/wasm/",
  iccUrl: "/pdfjs/iccs/",
  isEvalSupported: false,
  enableXfa: false,
  useSystemFonts: false,
};

const cx = (...names: string[]) => names.map((n) => `${styles[n] ?? ""} ${n}`).join(" ");

/** Port of legacy pdf-reader.js on react-pdf: all pages at the column width, page navigation. */
export default function PdfReader({ file, title, onError }: { file: Blob; title: string; onError: () => void }) {
  const t = useTranslations("Pdf");
  const [pages, setPages] = useState(0);
  const [current, setCurrent] = useState(1);
  const [width, setWidth] = useState(0);
  const stack = useRef<HTMLDivElement>(null);
  const pending = useRef<number | null>(null);

  useEffect(() => {
    const el = stack.current;
    if (!el) return;
    const resize = new ResizeObserver(([entry]) => setWidth(Math.min(entry!.contentRect.width, 56 * 16)));
    resize.observe(el);
    return () => resize.disconnect();
  }, [pages]);

  // Follow the page nearest the top while scrolling.
  useEffect(() => {
    if (!pages) return;
    const figures = Array.from(stack.current?.querySelectorAll<HTMLElement>("figure[data-page]") ?? []);
    const seen = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top && pending.current === null) setCurrent(Number((top.target as HTMLElement).dataset.page));
      },
      { rootMargin: "-40% 0px -55% 0px" },
    );
    figures.forEach((f) => seen.observe(f));
    return () => seen.disconnect();
  }, [pages]);

  function go(number: number) {
    if (number < 1 || number > pages || number === current) return;
    pending.current = number;
    setCurrent(number);
    const figure = stack.current?.querySelector<HTMLElement>(`figure[data-page="${number}"]`);
    figure?.scrollIntoView({ behavior: "instant", block: "start" });
    sequence(Array.from(figure?.children ?? []));
    setTimeout(() => (pending.current = null), 300);
  }

  return (
    <section className={cx("compi-pdf-document")} aria-label={t("label", { title })} aria-busy={!pages}>
      <Document
        file={file}
        options={options}
        onLoadSuccess={({ numPages }) => setPages(numPages)}
        onLoadError={onError}
        onSourceError={onError}
        loading={<p className={cx("pdf-status")} role="status">{t("loading")}</p>}
        error={<p className={cx("pdf-status")} role="status">{t("loading")}</p>}
      >
        {pages > 0 && (
          <div className={cx("pdf-controls")}>
            <button type="button" className={cx("pdf-step")} aria-label={t("previous")} disabled={current <= 1} onClick={() => go(current - 1)}>
              <span aria-hidden="true">‹</span>
            </button>
            <label className={cx("pdf-page-label")}>
              <span>{t("page")}</span>
              <select className={cx("pdf-page-select")} aria-label={t("goTo")} value={current} onChange={(e) => go(Number(e.target.value))}>
                {Array.from({ length: pages }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </select>
              <span>{t("ofTotal", { total: pages })}</span>
            </label>
            <button type="button" className={cx("pdf-step")} aria-label={t("next")} disabled={current >= pages} onClick={() => go(current + 1)}>
              <span aria-hidden="true">›</span>
            </button>
          </div>
        )}
        <div ref={stack} className={cx("pdf-pages")}>
          {Array.from({ length: pages }, (_, i) => (
            <figure key={i} data-page={i + 1} className={cx("pdf-page")}>
              <div className={cx("pdf-paper")}>
                {width > 0 && (
                  <Page
                    pageNumber={i + 1}
                    width={width}
                    renderAnnotationLayer={false}
                    loading={null}
                    error={<div className={cx("pdf-page-error")}><p>{t("pageFailed")}</p></div>}
                  />
                )}
              </div>
              <figcaption>{t("caption", { number: i + 1, total: pages })}</figcaption>
            </figure>
          ))}
        </div>
      </Document>
    </section>
  );
}
