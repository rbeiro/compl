"use client";

import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import {
  createGuide,
  createOutlet,
  deleteGuide,
  deleteOutlet,
  publishGuide,
  renameGuide,
  renameOutlet,
  type CatalogResult,
} from "@/app/actions/catalog";
import { useConfirm } from "@/components/confirm-dialog";
import { useRouter } from "@/i18n/navigation";
import { catalogError } from "@/lib/catalog-errors";
import styles from "./archive-edit.module.css";

// Port of the archive editing controls in legacy management.js:
// folderControls() on the hotel, outlet and guide-list levels and
// guideControls() on a guide (rename, upload Word/PDF, publish, remove).

const cx = (...names: (string | false | null | undefined)[]) =>
  names.filter(Boolean).map((n) => `${styles[n as string] ?? ""} ${n}`).join(" ");
const route = (parts: string[]) => `/empresa/${parts.map(encodeURIComponent).join("/")}`.replace(/\/$/, "");

type Ctx = { hotelKey: string; outletKey: string; hotel: string; outlet?: string };
type Run = () => Promise<void>;

function Feedback({ message }: { message: string | null }) {
  return (
    <p className="alert-ok feedback" role="status">
      {message ?? ""}
    </p>
  );
}

/** Legacy `act()`: disable the button while the work runs; show failures below it. */
function useAct() {
  const t = useTranslations("ArchiveEdit");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const act = async (work: () => Promise<CatalogResult | void>) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await work();
      if (result && !result.ok) setMessage(t(result.error));
    } catch {
      setMessage(t("failed"));
    } finally {
      setBusy(false);
    }
  };
  return { busy, message, setMessage, act };
}

function Manage({ summary, open, className, children }: { summary: string; open?: boolean; className?: string; children: ReactNode }) {
  return (
    <details className={cx("manage", className)} open={open}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}

function NameForm({ caption, initial = "", submit, onSave }: { caption: string; initial?: string; submit: string; onSave: (name: string) => Promise<CatalogResult> }) {
  const { busy, message, act } = useAct();
  const [name, setName] = useState(initial);
  return (
    <form
      className={cx("edit-form")}
      onSubmit={(e) => {
        e.preventDefault();
        void act(() => onSave(name.trim()));
      }}
    >
      <label>
        {caption}
        <input name="nombre" type="text" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <button type="submit" className="btn download" disabled={busy}>
        {submit}
      </button>
      <Feedback message={message} />
    </form>
  );
}

function Remove({ folder, onRemove }: { folder: boolean; onRemove: () => Promise<CatalogResult> }) {
  const t = useTranslations("ArchiveEdit");
  const [confirm, dialog] = useConfirm();
  const { busy, message, act } = useAct();
  const label = t(folder ? "deleteFolder" : "deleteGuide");
  return (
    <>
      <button
        type="button"
        className="btn download danger"
        disabled={busy}
        onClick={async () => {
          if (await confirm({ message: t(folder ? "deleteFolderQuestion" : "deleteGuideQuestion"), accept: label, danger: true })) {
            void act(onRemove);
          }
        }}
      >
        {label}
      </button>
      <Feedback message={message} />
      {dialog}
    </>
  );
}

/** Legacy folderControls(level, ctx, rank, parts). */
export function FolderControls({ level, ctx, rank, parts }: { level: number; ctx: Ctx; rank: number; parts: string[] }) {
  const t = useTranslations("ArchiveEdit");
  const router = useRouter();
  // Refresh first: it drops the router cache, so the destination renders fresh data.
  const go = (path: string) => {
    router.refresh();
    router.push(path);
  };
  const then = (result: CatalogResult, next: () => void) => {
    if (result.ok) next();
    return result;
  };
  if (level === 1 && rank === 1) {
    return (
      <Manage summary={t("createOutletFolder")}>
        <NameForm
          caption={t("outletName")}
          submit={t("createFolder")}
          onSave={async (name) => then(await createOutlet(ctx.hotelKey, name), () => go(route([...parts, name])))}
        />
      </Manage>
    );
  }
  if (level === 2 && rank === 1) {
    return (
      <Manage summary={t("manageFolder")}>
        <NameForm
          caption={t("outletName")}
          initial={ctx.outlet}
          submit={t("saveName")}
          onSave={async (name) => then(await renameOutlet(ctx.hotelKey, ctx.outletKey, name), () => go(route([ctx.hotel, name])))}
        />
        <Remove folder onRemove={async () => then(await deleteOutlet(ctx.hotelKey, ctx.outletKey), () => go(route([ctx.hotel])))} />
      </Manage>
    );
  }
  if (level === 3 && rank <= 2) {
    return (
      <Manage summary={t("addGuide")}>
        <NameForm
          caption={t("dishName")}
          submit={t("createDraft")}
          onSave={async (name) => {
            const result = await createGuide(ctx.hotelKey, ctx.outletKey, name);
            if (result.ok && result.key) go(route([...parts, result.key]));
            return result;
          }}
        />
      </Manage>
    );
  }
  return null;
}

const signatureOk = async (file: File, ext: "pdf" | "docx") => {
  const signature = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  return ext === "pdf" ? String.fromCharCode(...signature) === "%PDF-" : signature[0] === 80 && signature[1] === 75;
};

function UploadForm({ row, ext, draft, onSaved }: { row: Ctx & { guideKey: string }; ext: "pdf" | "docx"; draft: boolean; onSaved: Run }) {
  const t = useTranslations("ArchiveEdit");
  const { busy, message, setMessage, act } = useAct();
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const caption = ext === "pdf" ? t(draft ? "uploadPdf" : "replacePdf") : t(draft ? "uploadWord" : "replaceWord");
  return (
    <form
      className={cx("edit-form")}
      onSubmit={(e) => {
        e.preventDefault();
        void act(async () => {
          if (!file) return;
          if (!file.name.toLowerCase().endsWith(`.${ext}`) || file.size < 4 || file.size > 10 * 1024 * 1024) {
            setMessage(t("invalidFile", { ext }));
            return;
          }
          if (!(await signatureOk(file, ext))) {
            setMessage(t("mismatch"));
            return;
          }
          const path = [row.hotelKey, row.outletKey, row.guideKey, "files", ext].map(encodeURIComponent).join("/");
          const response = await fetch(`/api/guides/${path}`, { method: "PUT", body: file, headers: { "Content-Type": "application/octet-stream" } });
          if (!response.ok) {
            const body = await response.json().catch(() => null);
            return { ok: false, error: catalogError(response.status, body) } as CatalogResult;
          }
          setFile(null);
          setInputKey((k) => k + 1);
          setMessage(t(ext === "pdf" ? "pdfSaved" : "wordSaved"));
          if (!draft) await onSaved();
        });
      }}
    >
      <label>
        {ext === "pdf" ? t("pdf") : t("word")}
        <span className={cx("guide-file-field")}>
          <span className={cx("localized-file")}>
            <span className="btn download">{t("chooseFile")}</span>
            <input key={inputKey} name={ext} type="file" accept={`.${ext}`} required onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </span>
          <bdi className={cx("guide-file-name")} aria-live="polite">
            {file?.name ?? t("noFile")}
          </bdi>
        </span>
      </label>
      <button type="submit" className="btn download" disabled={busy}>
        {caption}
      </button>
      <Feedback message={message} />
    </form>
  );
}

/** Legacy guideControls(row, rank, signal, parts). */
export function GuideControls({ row, rank, parts }: { row: Ctx & { guideKey: string; title: string; state: string }; rank: number; parts: string[] }) {
  const t = useTranslations("ArchiveEdit");
  const router = useRouter();
  const { busy, message, act } = useAct();
  if (rank > 2) return null;
  const draft = row.state === "draft";
  const refresh = async () => router.refresh();
  return (
    <Manage summary={t(draft ? "completeDraft" : "editGuide")} open={draft} className="guide-editor">
      <NameForm
        caption={t("guideName")}
        initial={row.title}
        submit={t("saveName")}
        onSave={async (name) => {
          const result = await renameGuide(row.hotelKey, row.outletKey, row.guideKey, name);
          if (result.ok) router.refresh();
          return result;
        }}
      />
      <UploadForm row={row} ext="docx" draft={draft} onSaved={refresh} />
      <UploadForm row={row} ext="pdf" draft={draft} onSaved={refresh} />
      {draft && (
        <>
          <button
            type="button"
            className="btn btn-primary download primary"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const result = await publishGuide(row.hotelKey, row.outletKey, row.guideKey);
                if (result.ok) router.refresh();
                return result;
              })
            }
          >
            {t("publish")}
          </button>
          <Feedback message={message} />
        </>
      )}
      {rank === 1 && (
        <Remove
          folder={false}
          onRemove={async () => {
            const result = await deleteGuide(row.hotelKey, row.outletKey, row.guideKey);
            if (result.ok) {
              router.refresh();
              router.push(route(parts.slice(0, 3)));
            }
            return result;
          }}
        />
      )}
    </Manage>
  );
}
