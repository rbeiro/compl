"use client";

import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  changeMessage,
  createFolder,
  deleteFolder,
  readMailbox,
  saveMessage,
  type MailEntry,
  type MailItem,
  type Mailbox as MailboxData,
  type MailResult,
} from "@/app/actions/mail";
import { SelectField } from "@/components/select-field";
import { WsIcon } from "@/components/workspace/ws-icon";
import { duo, sequence } from "@/lib/motion";
import styles from "./mail.module.css";

// Port of legacy/public/mailbox.js (#/correo): base boxes and personal
// folders, message list with paging, reading, autosaved drafts, sending,
// starring and moving messages. Motion: "mail-open"/"mail-draft"/"confirm-folder"
// use the secuencia preset, "mail-favorite" uses duo.

const cx = (...names: (string | false | null | undefined)[]) =>
  names.filter(Boolean).map((n) => `${styles[n as string] ?? ""} ${n}`).join(" ");

const boxes = { inbox: "inbox", sent: "sent", drafts: "drafts", starred: "starred" } as const;
type BaseBox = keyof typeof boxes;
const symbols: Record<BaseBox, string> = { inbox: "mail", sent: "send", drafts: "compose", starred: "star" };
const empty: Record<BaseBox, string> = {
  inbox: "emptyInbox",
  sent: "emptySent",
  drafts: "emptyDrafts",
  starred: "emptyStarred",
};
const isBase = (id: string): id is BaseBox => id in boxes;
const pageSize = 40;

type Hotel = { key: string; name: string };
type Status = { key: string; params?: Record<string, string> } | null;
type Mode = "list" | "detail" | "compose";
type Editor = { save: () => Promise<void>; stop: () => void; dirty: () => boolean };
type Draft = { item: MailItem | null; prefill: { to?: string; subject?: string }; serial: number };

class MailError extends Error {}
function must<T>(result: MailResult<T>): T {
  if (!result.ok) throw new MailError(result.error);
  return result.data;
}

const noop = () => () => {};
/** False during server rendering and hydration (dates use the browser's time zone). */
const useMounted = () => useSyncExternalStore(noop, () => true, () => false);

function MailDate({ date }: { date: string }) {
  const locale = useLocale();
  const mounted = useMounted();
  const lang = locale === "pt" ? "pt-PT" : locale;
  return (
    <time dateTime={date}>
      {mounted
        ? new Intl.DateTimeFormat(lang, { dateStyle: "short", timeStyle: "short", calendar: "gregory" }).format(new Date(date))
        : ""}
    </time>
  );
}

/** Legacy `action()`: a button disabled while its work runs. */
function Action({
  className = "btn",
  onRun,
  children,
  ...rest
}: { className?: string; onRun: (button: HTMLButtonElement) => Promise<void> | void; children?: ReactNode } & Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "className"
>) {
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);
  return (
    <button
      type="button"
      {...rest}
      className={className}
      disabled={busy}
      onClick={async (event) => {
        if (busy) return;
        const button = event.currentTarget;
        setBusy(true);
        try {
          await onRun(button);
        } finally {
          if (mounted.current) setBusy(false);
        }
      }}
    >
      {children}
    </button>
  );
}

export function Mailbox({ hotels }: { hotels: Hotel[] }) {
  const t = useTranslations("Mail");
  const locale = useLocale();
  const router = useRouter();
  const [hotel, setHotel] = useState(hotels[0]!.key);
  const [box, setBox] = useState("inbox");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<MailboxData | null>(null);
  const [mode, setMode] = useState<Mode>("list");
  const [item, setItem] = useState<MailItem | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [deleting, setDeleting] = useState<HTMLElement | null>(null);

  const request = useRef(0);
  const editor = useRef<Editor | null>(null);
  const state = useRef({ hotel, box, page, mode, data });
  useLayoutEffect(() => {
    state.current = { hotel, box, page, mode, data };
  });
  const layout = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);
  const panel = useRef<HTMLElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const afterRender = useRef<(() => void) | null>(null);
  const newFolder = useRef<HTMLDetailsElement>(null);

  useLayoutEffect(() => {
    const run = afterRender.current;
    afterRender.current = null;
    run?.();
  });

  const say = (key: string | null, params?: Record<string, string>) => setStatus(key ? { key, params } : null);

  const safe = useCallback(async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (error) {
      setStatus({ key: error instanceof MailError ? error.message : "failed" });
    }
  }, []);

  const folderName = (id: string) =>
    isBase(id) ? t(id) : (data?.folders.find((f) => f.id === id)?.label ?? t("folder"));

  const leaveEditor = useCallback(async () => {
    const current = editor.current;
    if (!current) return;
    await current.save();
    current.stop();
    editor.current = null;
  }, []);

  const visit = useCallback(
    async (target = state.current.box, offset = state.current.page, h = state.current.hotel) => {
      await leaveEditor();
      const n = ++request.current;
      const next = must(await readMailbox(h, target, offset));
      if (n !== request.current) return;
      const returning = state.current.mode === "detail";
      setData(next);
      setBox(target);
      setPage(offset);
      setMode("list");
      setItem(null);
      setDraft(null);
      if (returning) afterRender.current = () => sequence([...(panel.current?.children ?? [])], { backwards: true });
    },
    [leaveEditor],
  );

  // First load (legacy `await safe(() => visit())`).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load, as legacy mailbox()
    void safe(() => visit("inbox", 0));
  }, [safe, visit]);

  const compose = useCallback(
    (m: MailItem | null = null, prefill: Draft["prefill"] = {}) => {
      request.current++;
      setMode("compose");
      setItem(m);
      setStatus(null);
      setDraft((d) => ({ item: m, prefill, serial: (d?.serial ?? 0) + 1 }));
    },
    [],
  );

  const openItem = useCallback(
    async (m: MailEntry) => {
      const { hotel: h, box: b, page: p } = state.current;
      if (m.unread) must(await changeMessage(h, m.id, { action: "read" }));
      const n = ++request.current;
      const result = must(await readMailbox(h, b, p, m.id));
      if (n !== request.current) return;
      setData(result);
      const opened = result.item!;
      if (opened.origin === "drafts") {
        compose(opened);
        return;
      }
      const opening = state.current.mode !== "detail";
      setItem(opened);
      setMode("detail");
      if (opening) afterRender.current = () => sequence([...(panel.current?.children ?? [])]);
    },
    [compose],
  );

  /** Legacy `favorite()`: toggles the star, refreshes, then bounces the star. */
  const toggleStar = async (m: MailEntry, refresh: () => Promise<void>) => {
    const next = !m.starred;
    must(await changeMessage(state.current.hotel, m.id, { action: "star", value: next }));
    await refresh();
    afterRender.current = () => {
      const star = panel.current?.querySelector<HTMLElement>(`.mail-star[data-mail-id="${m.id}"]`);
      // Removing the last star in Favorites also removes its row.
      const target = star ?? nav.current?.querySelector<HTMLElement>('.mail-folder[aria-current="page"]');
      if (!target) return;
      duo(target.querySelector("svg") ?? target, { positive: next });
      target.focus({ preventScroll: true });
    };
  };

  // Refresh the list every 20 s while the user is not interacting with it.
  useEffect(() => {
    const timer = setInterval(() => {
      const { mode: m, data: d, hotel: h, box: b, page: p } = state.current;
      if (document.hidden || m !== "list" || !d || newFolder.current?.open || deleting) return;
      if (layout.current?.contains(document.activeElement)) return;
      const n = request.current;
      void safe(async () => {
        const next = must(await readMailbox(h, b, p));
        if (request.current !== n || state.current.mode !== "list") return;
        if (JSON.stringify(next.entries) !== JSON.stringify(d.entries) || JSON.stringify(next.folders) !== JSON.stringify(d.folders)) {
          setData(next);
        }
      });
    }, 20000);
    return () => clearInterval(timer);
  }, [deleting, safe]);

  // Unsaved draft: warn on unload, and save before following an in-app link.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (editor.current?.dirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const leaving = (event: globalThis.MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!editor.current?.dirty() || !link || link.origin !== location.origin || event.ctrlKey || event.metaKey) return;
      if (link.pathname === location.pathname) return;
      event.preventDefault();
      void safe(async () => {
        await leaveEditor();
        router.push(link.pathname + link.search + link.hash);
      });
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", leaving, { capture: true });
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", leaving, { capture: true });
      editor.current?.stop();
    };
  }, [leaveEditor, router, safe]);

  const changeHotel = (next: string) =>
    safe(async () => {
      await leaveEditor();
      request.current++;
      setHotel(next);
      setData(null);
      setStatus(null);
      await visit("inbox", 0, next);
    });

  const statusText = status ? t(status.key, status.params) : "";

  // ---- Sidebar ----------------------------------------------------------
  const folderButton = (id: string, label: string, symbol: string) => (
    <Action
      key={id}
      className={cx("mail-folder")}
      aria-current={id === box && mode !== "compose" ? "page" : undefined}
      onRun={() =>
        safe(async () => {
          await visit(id, 0);
          setStatus(null);
        })
      }
    >
      <WsIcon name={symbol} className={cx("icon")} />
      <span dir={isBase(id) ? undefined : "auto"}>{label}</span>
    </Action>
  );

  const [folderLabel, setFolderLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const sidebar = data && (
    <>
      <Action
        className={`btn btn-primary ${cx("mail-compose")} download primary`}
        onRun={() =>
          safe(async () => {
            await leaveEditor();
            compose();
          })
        }
      >
        <WsIcon name="compose" className={cx("icon")} />
        <span>{t("compose")}</span>
      </Action>
      {(Object.keys(boxes) as BaseBox[]).map((id) => folderButton(id, t(id), symbols[id]))}
      <h2>{t("myFolders")}</h2>
      {data.folders.map((f) => folderButton(f.id, f.label, "folder"))}
      <details ref={newFolder} className={cx("mail-newfolder")}>
        <summary>{t("createFolder")}</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (creating) return;
            setCreating(true);
            void safe(async () => {
              await leaveEditor();
              const created = must(await createFolder(state.current.hotel, folderLabel.trim()));
              await visit(created.id, 0);
              setFolderLabel("");
              say("folderCreated");
            }).finally(() => setCreating(false));
          }}
        >
          <label>
            <span>{t("folderName")}</span>
            <input required maxLength={60} dir="auto" value={folderLabel} onChange={(e) => setFolderLabel(e.target.value)} />
          </label>
          <button type="submit" className="btn download" disabled={creating}>
            {t("create")}
          </button>
        </form>
      </details>
    </>
  );

  // ---- Shared pieces ------------------------------------------------------
  const moveMessage = (m: MailItem, target: string) =>
    safe(async () => {
      await leaveEditor();
      must(await changeMessage(state.current.hotel, m.id, { action: "move", folder: target || null }));
      const name = folderName(target || m.origin);
      await visit();
      say("moved", { carpeta: name });
    });

  // ---- Panel --------------------------------------------------------------
  let content: ReactNode = null;
  if (data && mode === "list") {
    const entries = data.entries.slice(0, pageSize);
    content = (
      <>
        <div className={cx("mail-panel-head")}>
          <h2 dir={isBase(box) ? undefined : "auto"}>{folderName(box)}</h2>
          <Action className={cx("mail-text")} onRun={() => safe(() => visit(box, page))}>
            <span>{t("refresh")}</span>
          </Action>
          {!isBase(box) && (
            <Action className={cx("mail-text", "danger")} onRun={(button) => setDeleting(button)}>
              <span>{t("deleteFolder")}</span>
            </Action>
          )}
        </div>
        {!data.entries.length && (
          <div className={cx("mail-empty")}>
            <WsIcon name={isBase(box) ? symbols[box] : "folder"} className={cx("icon")} />
            <p>{t(isBase(box) ? empty[box] : "emptyFolder")}</p>
          </div>
        )}
        {entries.map((m) => {
          const recipients = { destinatarios: m.recipients };
          const who = m.origin === "inbox" ? m.sender : m.recipients ? t("to", recipients) : t("noRecipient");
          return (
            <div key={m.id} className={cx("mail-row", m.unread && "unread")}>
              <Action
                className={cx("mail-row-open")}
                aria-label={m.unread ? t("unreadLabel", { persona: who, asunto: m.subject || t("noSubject") }) : undefined}
                onRun={() => safe(() => openItem(m))}
              >
                <span className={cx("mail-row-top")}>
                  <span dir={m.origin === "inbox" ? "auto" : undefined}>{who}</span>
                  <MailDate date={m.updated_at} />
                </span>
                {m.subject ? <strong dir="auto">{m.subject}</strong> : <strong>{t("noSubject")}</strong>}
                <span className={cx("mail-snippet")} dir="auto">
                  {m.snippet ?? ""}
                </span>
              </Action>
              <Star m={m} onToggle={() => safe(() => toggleStar(m, () => visit(box, page)))} />
            </div>
          );
        })}
        {(page > 0 || data.entries.length > pageSize) && (
          <div className={cx("mail-actions")}>
            {page > 0 && (
              <Action className="btn download" onRun={() => safe(() => visit(box, page - 1))}>
                <span>{t("previous")}</span>
              </Action>
            )}
            <span>{t("page", { numero: new Intl.NumberFormat(locale).format(page + 1) })}</span>
            {data.entries.length > pageSize && (
              <Action className="btn download" onRun={() => safe(() => visit(box, page + 1))}>
                <span>{t("next")}</span>
              </Action>
            )}
          </div>
        )}
      </>
    );
  } else if (data && mode === "detail" && item) {
    content = (
      <>
        <Action className={cx("mail-text")} onRun={() => safe(() => visit(box, page))}>
          <span>{t("backTo", { carpeta: folderName(box) })}</span>
        </Action>
        {item.subject ? <h2 dir="auto">{item.subject}</h2> : <h2>{t("noSubject")}</h2>}
        <dl className={cx("mail-meta")}>
          <dt>{t("from")}</dt>
          <dd dir="auto" translate="no">{item.sender}</dd>
          <dt>{t("toField")}</dt>
          <dd dir="auto" translate="no">{item.recipients}</dd>
          <dt>{t("date")}</dt>
          <dd>
            <MailDate date={item.updated_at} />
          </dd>
        </dl>
        <p className={cx("mail-body")} dir="auto">
          {item.body}
        </p>
        <div className={cx("mail-actions")}>
          <Star m={item} onToggle={() => safe(() => toggleStar(item, () => openItem(item)))} />
          {item.origin === "inbox" && (
            <Action
              className="btn download"
              onRun={() =>
                compose(null, {
                  to: item.sender,
                  subject: /^Re:/i.test(item.subject) ? item.subject : `Re: ${item.subject}`,
                })
              }
            >
              <span>{t("reply")}</span>
            </Action>
          )}
        </div>
        <MoveControl key={item.id} m={item} folders={data.folders} homeLabel={folderName(item.origin)} onMove={(target) => moveMessage(item, target)} />
      </>
    );
  } else if (data && mode === "compose" && draft) {
    content = (
      <Compose
        key={draft.serial}
        hotel={hotel}
        draft={draft}
        editorRef={editor}
        safe={safe}
        say={say}
        onSent={async () => {
          await visit("sent", 0);
          say("sentOk");
        }}
        onSaved={async () => {
          await visit("drafts", 0);
          say("draftSaved");
          afterRender.current = () => sequence([statusRef.current]);
        }}
        tools={
          draft.item && (
            <>
              <div className={cx("mail-actions")}>
                <Star
                  m={draft.item}
                  onToggle={() =>
                    safe(() =>
                      toggleStar(draft.item!, async () => {
                        await leaveEditor();
                        await openItem(draft.item!);
                      }),
                    )
                  }
                />
              </div>
              <MoveControl key={draft.item.id} m={draft.item} folders={data.folders} homeLabel={folderName(draft.item.origin)} onMove={(target) => moveMessage(draft.item!, target)} />
            </>
          )
        }
      />
    );
  }

  return (
    <div className={cx("root")}>
      <div className={cx("mail-account")}>
        {hotels.length > 1 && (
          <label>
            <span>{t("hotel")}</span>
            <SelectField
              value={hotel}
              onValueChange={(next) => void changeHotel(next)}
              options={hotels.map((h) => ({ value: h.key, label: h.name }))}
              className={selectClass}
            />
          </label>
        )}
        <bdi className="mail-address" dir="ltr">
          {data?.address ?? ""}
        </bdi>
      </div>
      <p ref={statusRef} className={cx("mail-status")} role="status">
        {statusText}
      </p>
      <div ref={layout} className={cx("mail-layout")}>
        <nav ref={nav} className={cx("mail-nav")} aria-label={t("navLabel")}>
          {sidebar}
        </nav>
        <section ref={panel} className={cx("mail-panel")} aria-label={t("panelLabel")}>
          {content}
        </section>
      </div>
      <DeleteFolderDialog
        trigger={deleting}
        name={folderName(box)}
        onClose={async (confirmed) => {
          const trigger = deleting;
          setDeleting(null);
          trigger?.focus({ preventScroll: true });
          if (!confirmed) {
            if (trigger) sequence([trigger]);
            return;
          }
          await safe(async () => {
            must(await deleteFolder(state.current.hotel, state.current.box));
            await visit("inbox", 0);
            say("folderDeleted");
            afterRender.current = () => {
              sequence([statusRef.current]);
              nav.current?.querySelector<HTMLElement>('.mail-folder[aria-current="page"]')?.focus({ preventScroll: true });
            };
          });
        }}
      />
    </div>
  );
}

function Star({ m, onToggle }: { m: MailEntry; onToggle: () => Promise<void> }) {
  const t = useTranslations("Mail");
  const name = m.starred ? t("unstar") : t("star");
  return (
    <Action
      className={cx("mail-star")}
      data-mail-id={m.id}
      aria-pressed={m.starred}
      aria-label={t("starLabel", { accion: name, asunto: m.subject || t("noSubject") })}
      title={name}
      onRun={onToggle}
    >
      <WsIcon name="star" className={cx("icon")} />
      <span>{name}</span>
    </Action>
  );
}

function MoveControl({
  m,
  folders,
  homeLabel,
  onMove,
}: {
  m: MailItem;
  folders: { id: string; label: string }[];
  homeLabel: string;
  onMove: (target: string) => Promise<void>;
}) {
  const t = useTranslations("Mail");
  const [target, setTarget] = useState(m.folder ?? "");
  const options = [{ value: "", label: homeLabel }, ...folders.map((f) => ({ value: f.id, label: f.label }))];
  return (
    <div className={cx("mail-move")}>
      <label>
        <span>{t("moveTo")}</span>
        <SelectField value={target} onValueChange={setTarget} options={options} className={selectClass} />
      </label>
      <Action className="btn download" onRun={() => onMove(target)}>
        {t("move")}
      </Action>
    </div>
  );
}

/** Legacy native <select> metrics (input,select base rule) on the Radix select. */
const selectClass = "mt-[.3rem] min-h-[46px] py-[.6rem] text-base/[1.4] font-normal";

function DeleteFolderDialog({
  trigger,
  name,
  onClose,
}: {
  trigger: HTMLElement | null;
  name: string;
  onClose: (confirmed: boolean) => void;
}) {
  const t = useTranslations("Mail");
  const common = useTranslations("Common");
  const heading = useRef<HTMLHeadingElement>(null);
  const description = useRef<HTMLParagraphElement>(null);
  const buttons = useRef<HTMLDivElement>(null);
  return (
    <AlertDialog.Root open={!!trigger} onOpenChange={(open) => !open && onClose(false)}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={cx("mail-folder-backdrop")} />
        <AlertDialog.Content
          className={cx("mail-folder-dialog")}
          onOpenAutoFocus={() => requestAnimationFrame(() => sequence([heading.current, description.current, buttons.current]))}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <AlertDialog.Title asChild>
            <h2 ref={heading}>{t("deleteFolder")}</h2>
          </AlertDialog.Title>
          <AlertDialog.Description asChild>
            <p ref={description}>{t("deleteFolderQuestion", { carpeta: name })}</p>
          </AlertDialog.Description>
          <div ref={buttons} className={cx("mail-actions")}>
            <AlertDialog.Cancel className="btn download">{common("cancel")}</AlertDialog.Cancel>
            <AlertDialog.Action className={`btn download ${cx("danger")}`} onClick={() => onClose(true)}>
              {t("deleteFolder")}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/** New message or draft editor; drafts autosave 550 ms after the last change. */
function Compose({
  hotel,
  draft,
  editorRef,
  safe,
  say,
  onSent,
  onSaved,
  tools,
}: {
  hotel: string;
  draft: Draft;
  editorRef: React.RefObject<Editor | null>;
  safe: (fn: () => Promise<void>) => Promise<void>;
  say: (key: string | null) => void;
  onSent: () => Promise<void>;
  onSaved: () => Promise<void>;
  tools: ReactNode;
}) {
  const t = useTranslations("Mail");
  const m = draft.item;
  const [to, setTo] = useState(m?.recipients || draft.prefill.to || "");
  const [subject, setSubject] = useState(m?.subject || draft.prefill.subject || "");
  const [body, setBody] = useState(m?.body ?? "");
  const [saveState, setSaveState] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const stateRef = useRef<HTMLParagraphElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const values = useRef({ to, subject, body });
  useLayoutEffect(() => {
    values.current = { to, subject, body };
  });
  const work = useRef({
    id: m?.id ?? crypto.randomUUID(),
    revision: m?.revision ?? 0,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    queue: Promise.resolve() as Promise<void>,
    dirty: false,
    version: 0,
    closed: false,
  });
  const [settled, setSettled] = useState(0);

  const save = useCallback(() => {
    const w = work.current;
    clearTimeout(w.timer);
    w.queue = w.queue
      .catch(() => {})
      .then(async () => {
        if (!w.dirty || w.closed) return;
        const snapshot = w.version;
        const result = must(
          await saveMessage(hotel, w.id, { ...values.current, revision: w.revision, send: false }),
        );
        if (result.revision !== undefined) w.revision = result.revision;
        if (snapshot === w.version && !w.closed) {
          w.dirty = false;
          setSaveState("draftSaved");
          setSettled((n) => n + 1);
        }
      });
    return w.queue;
  }, [hotel]);

  useEffect(() => {
    editorRef.current = {
      save,
      stop: () => {
        clearTimeout(work.current.timer);
        work.current.closed = true;
      },
      dirty: () => work.current.dirty,
    };
    toRef.current?.focus();
    const w = work.current;
    return () => clearTimeout(w.timer);
  }, [editorRef, save]);

  useEffect(() => {
    if (saveState) sequence([stateRef.current]);
  }, [saveState, settled]);

  const changed = useCallback(() => {
    const w = work.current;
    if (!w.dirty) setSaveState("savingDraft");
    w.dirty = true;
    w.version++;
    clearTimeout(w.timer);
    w.timer = setTimeout(() => void safe(save), 550);
  }, [safe, save]);

  // A reply starts as a draft right away (legacy: `if (prefill.to || prefill.subject) changed()`).
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current) return;
    prefilled.current = true;
    if (draft.prefill.to || draft.prefill.subject) changed();
  }, [changed, draft.prefill]);

  const send = async () => {
    if (sending) return;
    const v = values.current;
    if (!v.to.trim() || !v.subject.trim() || !v.body.trim()) {
      say("incomplete");
      return;
    }
    setSending(true);
    try {
      await save();
      must(await saveMessage(hotel, work.current.id, { ...v, revision: work.current.revision, send: true }));
      editorRef.current?.stop();
      editorRef.current = null;
      await onSent();
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <h2>{t(m ? "editDraft" : "newMessage")}</h2>
      <form
        className={cx("mail-form")}
        onInput={changed}
        onSubmit={(event) => {
          event.preventDefault();
          void safe(send);
        }}
      >
        <label>
          <span>{t("toField")}</span>
          <input
            ref={toRef}
            maxLength={1500}
            dir="ltr"
            placeholder="a.vidal@compichef.com"
            value={to}
            readOnly={sending}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <small className={cx("hint")}>{t("recipientsHint")}</small>
        <label>
          <span>{t("subject")}</span>
          <input maxLength={200} dir="auto" value={subject} readOnly={sending} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label>
          <span>{t("message")}</span>
          <textarea maxLength={30000} dir="auto" rows={8} value={body} readOnly={sending} onChange={(e) => setBody(e.target.value)} />
        </label>
        <div className={cx("mail-actions")}>
          <button type="submit" className="btn btn-primary download primary" disabled={sending}>
            <WsIcon name="send" className={cx("icon")} />
            <span>{t("send")}</span>
          </button>
          <Action
            className="btn download"
            onRun={() =>
              safe(async () => {
                if (sending) return;
                if (!work.current.revision && !work.current.dirty) {
                  say("writeSomething");
                  return;
                }
                await save();
                await onSaved();
              })
            }
          >
            <span>{t("saveDraft")}</span>
          </Action>
        </div>
        <p ref={stateRef} className={cx("mail-save-state")} role="status">
          {saveState ? t(saveState) : ""}
        </p>
      </form>
      {tools}
    </>
  );
}

