"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  changeRank,
  deleteEmployee,
  loadStaff,
  registerEmployee,
  setAccess,
  type CreatedAccount,
  type StaffMember,
  type TeamResult,
} from "@/app/actions/team";
import { useConfirm } from "@/components/confirm-dialog";
import { SelectField } from "@/components/select-field";
import { sequence } from "@/lib/motion";
import styles from "./team.module.css";

// Port of the staff panel in legacy/public/management.js (#/equipo): register
// employees (account with a one-time password), search, change ranks,
// withdraw/restore access, delete. Motion "team-rank" = secuencia.

const cx = (...names: (string | false | null | undefined)[]) =>
  names.filter(Boolean).map((n) => `${styles[n as string] ?? ""} ${n}`).join(" ");

type Message = { key: string; params?: Record<string, string> } | null;
class TeamError extends Error {}
function must<T>(result: TeamResult<T>): T {
  if (!result.ok) throw new TeamError(result.error);
  return result.data;
}

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .toLocaleUpperCase();
// legacy positions.js: established roles have translated display names.
const roleNames = new Map([
  ["chef ejecutivo", "executiveChef"], ["chef ejecutiva", "executiveChef"], ["executive chef", "executiveChef"],
  ["chef de cocina", "headChef"], ["jefe de cocina", "headChef"], ["jefa de cocina", "headChef"], ["head chef", "headChef"],
  ["sous chef", "sousChef"], ["sous-chef", "sousChef"],
  ["chef de partida", "chefDePartie"], ["jefe de partida", "sectionChef"], ["jefa de partida", "sectionChef"],
  ["cocinero", "cook"], ["cocinera", "cook"],
  ["cocinero de noche", "nightCook"], ["cocinero de noches", "nightCook"], ["cocinera de noche", "nightCook"], ["cocinera de noches", "nightCook"],
  ["ayudante de cocina", "kitchenAssistant"],
]);

/** Native <select> metrics of the legacy form controls, on the Radix select. */
const selectClass = "mt-[.3rem] min-h-[46px] py-[.6rem] text-base/[1.4] font-normal";

/** A button disabled while its work runs (legacy `act()`). */
function Act({
  className = "btn download",
  onRun,
  children,
  ...rest
}: { className?: string; onRun: () => Promise<void>; children: ReactNode } & Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "className"
>) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      {...rest}
      className={className}
      disabled={busy || rest.disabled}
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        try {
          await onRun();
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
    </button>
  );
}

export function Team({ hotel, locale }: { hotel: string; locale: string }) {
  const t = useTranslations("Team");
  const positions = useTranslations("Positions");
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [status, setStatus] = useState<Message>(null);
  const [account, setAccount] = useState<CreatedAccount | null>(null);
  const [query, setQuery] = useState("");
  const [confirm, dialog] = useConfirm();
  const statusRef = useRef<HTMLParagraphElement>(null);
  const roster = useRef<HTMLDivElement>(null);
  const afterRender = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const run = afterRender.current;
    afterRender.current = null;
    run?.();
  });

  const render = useCallback(async () => {
    const result = await loadStaff(hotel);
    if (result.ok) setStaff(result.data.items);
    return result;
  }, [hotel]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load, as legacy panel()
    void render().then((result) => {
      if (!result.ok) setStatus({ key: result.error });
    });
  }, [render]);

  /** Runs an action; failures show in `show` (legacy act(): the button's own message). */
  const act = async (show: (m: Message) => void, work: () => Promise<void>) => {
    show(null);
    try {
      await work();
    } catch (error) {
      show({ key: error instanceof TeamError ? error.message : "failed" });
    }
  };

  const positionName = (name: string) => {
    const key = roleNames.get(name.trim().toLowerCase());
    return key && locale !== "es" ? positions(key) : name;
  };
  const columns = [t("colName"), t("colEmail"), t("colPosition"), t("colOutlet"), t("colRank"), t("colActions")];
  const rankOptions = (allowed = [1, 2, 3]) =>
    allowed.map((r) => ({ value: String(r), label: t(`rank${r}` as "rank1") }));

  const terms = (s: StaffMember) => fold([s.name, s.position, s.outlet, s.email].join(" "));
  const folded = fold(query.trim());
  const visible = staff?.filter((s) => terms(s).includes(folded)) ?? [];

  return (
    <div className={cx("root")}>
      <RegisterForm
        hotel={hotel}
        onCreated={async (created) => {
          await render();
          setAccount(created);
          setStatus({ key: "accountCreated", params: { email: created.email } });
        }}
        act={act}
      />
      <div className={cx("team-toolbar")}>
        <label>
          {t("search")}
          <input type="search" autoComplete="off" placeholder={t("searchPlaceholder")} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <Act onRun={async () => void (await render())}>{t("refreshList")}</Act>
      </div>
      <p ref={statusRef} id="staff-status" className="alert-ok feedback" role="status">
        {status ? t(status.key, status.params) : ""}
      </p>
      {account && <Credentials account={account} onDone={() => setAccount(null)} />}
      {staff && (
        <>
          <div
            ref={roster}
            className={cx("table-scroll", "team-roster")}
            role="region"
            aria-label={t("listLabel")}
            tabIndex={0}
            hidden={visible.length === 0}
          >
            <table>
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c} scope="col">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => (
                  <Row
                    key={s.id}
                    member={s}
                    hidden={!terms(s).includes(folded)}
                    columns={columns}
                    positionName={positionName}
                    rankOptions={rankOptions()}
                    onSaveRank={(next) =>
                      act(setStatus, async () => {
                        must(await changeRank(hotel, s.id, next, s.rank));
                        await render();
                        setStatus({ key: "rankChanged", params: { name: s.name, rank: String(next) } });
                        afterRender.current = () => {
                          const row = roster.current?.querySelector(`tr[data-member-id="${s.id}"]`);
                          sequence([row?.querySelector("[role=combobox]"), statusRef.current]);
                        };
                      })
                    }
                    onAccess={() =>
                      act(setStatus, async () => {
                        const restore = Boolean(s.withdrawnAt);
                        const question = restore ? "restoreQuestion" : "withdrawQuestion";
                        if (
                          !(await confirm({
                            message: t(question, { name: s.name, email: s.email }),
                            accept: t(restore ? "restoreAccess" : "withdrawAccess"),
                            danger: !restore,
                          }))
                        )
                          return;
                        must(await setAccess(hotel, s.id, restore, s.rank));
                        await render();
                        setStatus({ key: restore ? "restored" : "withdrawn", params: { name: s.name } });
                      })
                    }
                    onDelete={() =>
                      act(setStatus, async () => {
                        const pending = !s.hasAccount && !s.withdrawnAt;
                        if (
                          !(await confirm({
                            message: t(pending ? "deleteRecordQuestion" : "deleteEmployeeQuestion", { name: s.name, email: s.email }),
                            accept: t(pending ? "deleteRecord" : "deleteEmployee"),
                            danger: true,
                          }))
                        )
                          return;
                        must(await deleteEmployee(hotel, s.id, pending ? null : s.withdrawnAt));
                        await render();
                        setStatus({ key: "deleted", params: { name: s.name } });
                      })
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p className={cx("team-empty")} role="status" hidden={visible.length > 0}>
            {t("noResults")}
          </p>
        </>
      )}
      {dialog}
    </div>
  );
}

function inviteLabel(member: StaffMember) {
  if (member.inviteState === "cancelled") return "inviteCancelled";
  if (member.inviteUntil && Date.parse(member.inviteUntil) <= Date.now()) return "inviteExpired";
  return (
    ({ queued: "inviteQueued", delivered: "inviteDelivered", issued: "inviteIssued" } as Record<string, string>)[member.inviteState ?? ""] ??
    "inviteAwaiting"
  );
}

function Row({
  member: s,
  hidden,
  columns,
  positionName,
  rankOptions,
  onSaveRank,
  onAccess,
  onDelete,
}: {
  member: StaffMember;
  hidden: boolean;
  columns: string[];
  positionName: (name: string) => string;
  rankOptions: { value: string; label: string }[];
  onSaveRank: (rank: number) => Promise<void>;
  onAccess: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const t = useTranslations("Team");
  const [rank, setRank] = useState(String(s.rank));
  const row = useRef<HTMLTableRowElement>(null);
  const restore = Boolean(s.withdrawnAt);
  const pending = !s.hasAccount && !restore;
  return (
    <tr ref={row} data-member-id={s.id} hidden={hidden}>
      <td dir="auto" data-label={columns[0]}>
        <span className={cx("team-initials")} aria-hidden="true">
          {initials(s.name)}
        </span>
        {s.name}
      </td>
      <td dir="auto" data-label={columns[1]}>
        {s.email}
        {restore ? <small>{t("accessWithdrawn")}</small> : !s.hasAccount && <small>{t(inviteLabel(s))}</small>}
      </td>
      <td dir="auto" data-label={columns[2]}>
        {positionName(s.position)}
      </td>
      <td dir="auto" data-label={columns[3]}>
        {s.outlet}
      </td>
      <td data-label={columns[4]}>
        <SelectField
          value={rank}
          options={rankOptions}
          aria-label={t("rankFor", { name: s.name })}
          className="min-h-[46px] py-[.6rem] text-base/[1.4] font-normal data-[disabled]:cursor-default data-[disabled]:opacity-65"
          disabled={restore}
          onValueChange={(value) => {
            setRank(value);
            requestAnimationFrame(() => {
              const el = row.current;
              sequence([el?.querySelector("[role=combobox]"), el?.querySelector("[data-save-rank]")]);
            });
          }}
        />
      </td>
      <td data-label={columns[5]}>
        <Act data-save-rank="" disabled={Number(rank) === s.rank} onRun={() => onSaveRank(Number(rank))}>
          {t("save")}
        </Act>
        {pending ? (
          <Act className="btn download danger" aria-label={t("deleteRecordFor", { name: s.name })} onRun={onDelete}>
            {t("deleteRecord")}
          </Act>
        ) : (
          <>
            <Act
              className={restore ? "btn download" : "btn download danger"}
              aria-label={t(restore ? "restoreAccessFor" : "withdrawAccessFor", { name: s.name })}
              onRun={onAccess}
            >
              {t(restore ? "restoreAccess" : "withdrawAccess")}
            </Act>
            {restore && (
              <Act className="btn download danger" aria-label={t("deleteEmployeeFor", { name: s.name })} onRun={onDelete}>
                {t("deleteEmployee")}
              </Act>
            )}
          </>
        )}
      </td>
    </tr>
  );
}

function RegisterForm({
  hotel,
  onCreated,
  act,
}: {
  hotel: string;
  onCreated: (account: CreatedAccount) => Promise<void>;
  act: (show: (m: Message) => void, work: () => Promise<void>) => Promise<void>;
}) {
  const t = useTranslations("Team");
  const [message, setMessage] = useState<Message>(null);
  const [rank, setRank] = useState("3");
  const [busy, setBusy] = useState(false);
  // A new id whenever the form changes; a retry of the same data reuses it.
  const requestId = useRef<string>("");
  const field = (name: string, label: string) => (
    <label>
      {label}
      <input name={name} required maxLength={120} />
    </label>
  );
  return (
    <details className={cx("manage")}>
      <summary>{t("register")}</summary>
      <form
        className={cx("staff-form")}
        onInput={() => (requestId.current = "")}
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          const form = new FormData(event.currentTarget);
          const value = (key: string) => String(form.get(key) ?? "").trim();
          if (!requestId.current) requestId.current = crypto.randomUUID();
          setBusy(true);
          void act(setMessage, async () => {
            const created = must(
              await registerEmployee(hotel, {
                requestId: requestId.current,
                givenName: value("nombre"),
                surname: value("apellido"),
                position: value("posicion"),
                outlet: value("outlet"),
                rank: Number(rank) as 2 | 3,
              }),
            );
            await onCreated(created);
          }).finally(() => setBusy(false));
        }}
      >
        {field("nombre", t("givenName"))}
        {field("apellido", t("surname"))}
        {field("posicion", t("position"))}
        {field("outlet", t("outlet"))}
        <label>
          {t("accessRank")}
          <SelectField
            value={rank}
            className={selectClass}
            options={[2, 3].map((r) => ({ value: String(r), label: t(`rank${r}` as "rank2") }))}
            onValueChange={(v) => {
              setRank(v);
              requestId.current = "";
            }}
          />
        </label>
        <button type="submit" className="btn download" disabled={busy}>
          {t("register")}
        </button>
        <p className="alert-ok feedback" role="status">
          {message ? t(message.key, message.params) : ""}
        </p>
        <p className={cx("hint")}>{t("addressHint")}</p>
      </form>
    </details>
  );
}

/** Legacy credentials(): the one-time password card. */
function Credentials({ account, onDone }: { account: CreatedAccount; onDone: () => void }) {
  const t = useTranslations("Team");
  return (
    <section className="new-account">
      <p>{t("passwordOnce")}</p>
      {(
        [
          ["employeeEmail", account.email],
          ["temporaryPassword", account.password],
        ] as const
      ).map(([caption, value]) => (
        <CopyField key={caption} caption={t(caption)} value={value} />
      ))}
      <button type="button" className="btn download" onClick={onDone}>
        {t("copiedDone")}
      </button>
    </section>
  );
}

function CopyField({ caption, value }: { caption: string; value: string }) {
  const t = useTranslations("Team");
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <label>
        <span>{caption}</span>
        <input ref={input} readOnly value={value} dir="ltr" spellCheck={false} />
      </label>
      <button
        type="button"
        className="btn download"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
          } catch {
            input.current?.select();
          }
        }}
      >
        {t(copied ? "copied" : "copy")}
      </button>
    </>
  );
}
