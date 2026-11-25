"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useLocale, useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  decideLeave,
  editShift,
  loadSchedule,
  requestLeave,
  setBalance,
  type ScheduleResult,
  type ScheduleView,
} from "@/app/actions/schedule";
import { MonthPicker } from "@/components/pickers/month-picker";
import { SelectField } from "@/components/select-field";
import { carbon, sequence, tactil } from "@/lib/motion";
import styles from "./schedule.module.css";

// Port of legacy/public/horarios.js (#/horarios): monthly roster per
// department, shift editing (executive chef), leave selection and requests,
// leave decisions and hours balances. Motion as in legacy: "schedule",
// "leave-select", "leave-review" = secuencia; "shift-edit" = carbon;
// "hours-adjust" = tactil.

const cx = (...names: (string | false | null | undefined)[]) =>
  names.filter(Boolean).map((n) => `${styles[n as string] ?? ""} ${n}`).join(" ");

type Hotel = { key: string; name: string };
type Tab = "roster" | "leave" | "manage";
type Person = ScheduleView["people"][number];
type Balance = ScheduleView["balances"][number];
type Shift = ScheduleView["shifts"][number];
type Notice = { key: string; params?: Record<string, string>; error?: boolean } | null;
type Editing = { kind: "shift"; person: Person; date: string; shift?: Shift } | { kind: "hours"; person: Balance } | null;

const QUOTA = 45;
const tabs: [Tab, string][] = [
  ["roster", "roster"],
  ["leave", "requestLeave"],
  ["manage", "teamManagement"],
];
const states = { pending: "pending", approved: "approved", rejected: "rejected" } as const;

// ---- Legacy helpers (horarios.js) -----------------------------------------
const normalize = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const dayDate = (iso: string) => new Date(`${iso}T12:00:00Z`);
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const monthDate = (month: string) => dayDate(`${month}-01`);
function moveMonth(month: string, offset: number) {
  const date = monthDate(month);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}
function positionGroup(name: string) {
  const p = normalize(name);
  if (/ejecutiv|executive|director/.test(p)) return 0;
  if (/sous|segund[oa].*cocina|subchef|subjef/.test(p)) return 2;
  if (/jef[ea] de cocina|chef de cocina|head chef|chef de cuisine/.test(p)) return 1;
  if (/demi|segund[oa].*partida/.test(p)) return 4;
  if (/jef[ea] de partida|chef de part|supervisor/.test(p)) return 3;
  if (/ayudante|commis|auxiliar/.test(p)) return 6;
  if (/practi|trainee|becari[oa]|aprendiz/.test(p)) return 7;
  if (/cociner|pasteler|chef|cocinero/.test(p)) return 5;
  return 8;
}
const positionKey = (name: string) =>
  normalize(name).replace(/\bjefa\b/g, "jefe").replace(/\b(ejecutiv|cociner|pasteler|segund|becari)a\b/g, "$1o");

const badgeStyles = new Map([
  ["chef ejecutivo", "executive"], ["executive chef", "executive"],
  ["chef de cocina", "head"], ["jefe de cocina", "head"], ["head chef", "head"],
  ["sous chef", "sous"], ["chef de partida", "partida-chef"], ["jefe de partida", "partida-jefe"],
  ["cocinero", "cook"], ["cocinero de noches", "night"], ["cocinero de noche", "night"],
  ["ayudante de cocina", "assistant"],
]);
// legacy positions.js: established roles have translated names; custom ones keep their spelling.
const roleNames = new Map([
  ["chef ejecutivo", "executiveChef"], ["chef ejecutiva", "executiveChef"], ["executive chef", "executiveChef"],
  ["chef de cocina", "headChef"], ["jefe de cocina", "headChef"], ["jefa de cocina", "headChef"], ["head chef", "headChef"],
  ["sous chef", "sousChef"], ["sous-chef", "sousChef"],
  ["chef de partida", "chefDePartie"], ["jefe de partida", "sectionChef"], ["jefa de partida", "sectionChef"],
  ["cocinero", "cook"], ["cocinera", "cook"],
  ["cocinero de noche", "nightCook"], ["cocinero de noches", "nightCook"], ["cocinera de noche", "nightCook"], ["cocinera de noches", "nightCook"],
  ["ayudante de cocina", "kitchenAssistant"],
]);

function useFormats(locale: string) {
  return useMemo(() => {
    const regional = locale === "pt" ? "pt-PT" : locale;
    const dates = (options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(regional, { calendar: "gregory", timeZone: "UTC", ...options });
    const number = (options: Intl.NumberFormatOptions) => new Intl.NumberFormat(regional, options);
    return {
      collator: new Intl.Collator(regional, { sensitivity: "base", numeric: true }),
      month: dates({ month: "long", year: "numeric" }),
      short: dates({ month: "short", day: "numeric" }),
      dated: dates({ month: "short", day: "numeric", year: "numeric" }),
      weekday: dates({ weekday: "short" }),
      clock: dates({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
      number: number({ useGrouping: false }),
      clockDigit: number({ useGrouping: false, minimumIntegerDigits: 2 }),
      hours: number({ style: "unit", unit: "hour", unitDisplay: "short" }),
      minutes: number({ style: "unit", unit: "minute", unitDisplay: "short" }),
      days: number({ style: "unit", unit: "day", unitDisplay: "long" }),
      list: new Intl.ListFormat(regional, { style: "short", type: "conjunction" }),
    };
  }, [locale]);
}
type Formats = ReturnType<typeof useFormats>;

function hoursText(f: Formats, minutes: number) {
  const n = Math.abs(minutes);
  const h = Math.floor(n / 60);
  const m = n % 60;
  return (minutes < 0 ? "−" : minutes > 0 ? "+" : "") + f.hours.format(h) + (m ? " " + f.minutes.format(m) : "");
}
/** Hours with each run of digits in its own span (legacy renderHourDigits), so only digits pulse. */
function HourDigits({ f, minutes }: { f: Formats; minutes: number }) {
  const parts = Number.isFinite(minutes) ? hoursText(f, minutes).split(/(\p{Nd}+)/u) : ["—"];
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 0 ? (
          part
        ) : (
          <span key={i} data-motion-number="">
            {part}
          </span>
        ),
      )}
    </>
  );
}
function pulseHours(element: Element | null | undefined, previous: string[] = []) {
  if (!element) return;
  const digits = [...element.querySelectorAll("[data-motion-number]")];
  const changed = digits.filter((span, i) => span.textContent !== previous[i]);
  tactil(...(changed.length ? changed : digits));
}
function ranges(f: Formats, days: string[]) {
  const result: string[] = [];
  let first: string | undefined;
  let last: string | undefined;
  const append = () => {
    if (first && last) result.push(first === last ? f.dated.format(dayDate(first)) : f.dated.formatRange(dayDate(first), dayDate(last)));
  };
  for (const date of [...days].sort()) {
    if (!last || dayDate(date).getTime() - dayDate(last).getTime() !== 86_400_000 || date.slice(0, 4) !== last.slice(0, 4)) {
      append();
      first = date;
    }
    last = date;
  }
  append();
  return f.list.format(result);
}
const clock = (f: Formats, time: string) => f.clock.format(new Date(`2000-01-01T${time.slice(0, 5)}:00Z`));

class ScheduleError extends Error {
  constructor(
    key: string,
    readonly status: number,
  ) {
    super(key);
  }
}
function must<T>(result: ScheduleResult<T>): T {
  if (!result.ok) throw new ScheduleError(result.error, result.status);
  return result.data;
}

/** Legacy displayPosition() + roleBadge(). */
function RoleBadge({ person }: { person: { position: string; rank: number } }) {
  const t = useTranslations("Positions");
  const locale = useLocale();
  const key = positionKey(person.position);
  const style = badgeStyles.get(key);
  const named = roleNames.get(person.position.trim().toLowerCase());
  const text = named && locale !== "es" ? t(named) : person.position;
  let custom: CSSProperties | undefined;
  if (!style) {
    const family = ({ 1: "green", 2: "plum", 3: "ivory" } as Record<number, string>)[person.rank] ?? "ivory";
    const hash = Array.from(key).reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
    custom = { "--role-family": `var(--compi-${family})`, "--role-strength": `${16 + (hash % 2200) / 100}%` } as CSSProperties;
  }
  return (
    <span className={cx("sched-role", style ? `role-${style}` : "role-other")} style={custom}>
      {text}
    </span>
  );
}

function madridToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid" }).format(new Date());
}

export function Schedules({ hotels }: { hotels: Hotel[] }) {
  const t = useTranslations("Schedule");
  const locale = useLocale();
  const f = useFormats(locale);
  const [today] = useState(madridToday);
  const [hotel, setHotel] = useState(hotels[0]!.key);
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [department, setDepartment] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("roster");
  const [data, setData] = useState<ScheduleView | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<Editing>(null);
  const [dialogStatus, setDialogStatus] = useState<string | null>(null);

  const [rootEl, setRootEl] = useState<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const requestId = useRef<string>("");
  const turn = useRef(0);
  const saving = useRef(false);
  const scrolled = useRef(0);
  const afterRender = useRef<(() => void) | null>(null);
  const view = useRef({ hotel, month, department, tab, chosen });
  useLayoutEffect(() => {
    view.current = { hotel, month, department, tab, chosen };
    const run = afterRender.current;
    afterRender.current = null;
    run?.();
  });

  const say = (key: string | null, error = false, params?: Record<string, string>) =>
    setNotice(key ? { key, params, error } : null);
  const resetChoice = () => {
    setChosen(new Set());
    requestId.current = crypto.randomUUID();
  };

  const load = useCallback(
    async (direction?: "previous" | "next" | "up", next?: Partial<{ hotel: string; month: string; department: string | null; tab: Tab }>) => {
      const v = { ...view.current, ...next };
      const n = ++turn.current;
      setBusy(true);
      try {
        const result = must(await loadSchedule(v.hotel, v.month, v.tab === "leave" ? null : v.department));
        if (n !== turn.current) return false;
        const reserved = new Set(result.mine.filter((x) => x.state !== "rejected").flatMap((x) => x.days));
        setChosen((current) => {
          const kept = [...current].filter((d) => !reserved.has(d));
          return kept.length === current.size ? current : new Set(kept);
        });
        setData(result);
        setFailed(false);
        if (direction) {
          afterRender.current = () => {
            const table = panel.current?.querySelector(".schedule-grid,.sched-team-table");
            if (table) sequence([...table.querySelectorAll("tr")], { backwards: direction === "previous" });
          };
        }
        return true;
      } catch (error) {
        if (n !== turn.current) return false;
        setData(null);
        setFailed(true);
        say(error instanceof ScheduleError ? error.message : "failed", true);
        return false;
      } finally {
        if (n === turn.current) setBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    requestId.current = crypto.randomUUID();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load, as legacy schedules()
    void load();
  }, [load]);

  /** Legacy write(): save, show the result, reload; a 409 reloads and closes the dialog. */
  const write = async (action: () => Promise<ScheduleResult<null>>, done: string, inDialog: boolean, onRendered?: () => void) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      must(await action());
      if (inDialog) setEditing(null);
      say(done);
      if (await load()) {
        const previous = afterRender.current;
        afterRender.current = () => {
          previous?.();
          onRendered?.();
        };
      }
    } catch (error) {
      const e = error instanceof ScheduleError ? error : new ScheduleError("failed", 0);
      if (e.status === 409) {
        setEditing(null);
        await load();
        say(e.message, true);
      } else if (inDialog) setDialogStatus(e.message);
      else say(e.message, true);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const changeMonth = (next: string) => {
    if (saving.current || !/^\d{4}-(0[1-9]|1[0-2])$/.test(next) || next.startsWith("0000") || next === month) return;
    const direction = next > month ? "next" : "previous";
    setMonth(next);
    scrolled.current = 0;
    say(null);
    void load(direction, { month: next });
  };

  const used = (year: string, state: "pending" | "approved") =>
    (data?.mine ?? []).filter((r) => r.state === state).flatMap((r) => r.days).filter((d) => d.startsWith(`${year}-`)).length;

  // ---- Pieces ---------------------------------------------------------------
  const deptName = (key: string) => data?.departments?.find((d) => d.key === key)?.name ?? key;

  function head(d: ScheduleView) {
    const rtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
    return (
      <div className={cx("sched-head")}>
        <div className={cx("sched-filters")}>
          {hotels.length > 1 && (
            <label className={cx("sched-field")}>
              <span>{t("hotel")}</span>
              <SelectField
                value={hotel}
                options={hotels.map((h) => ({ value: h.key, label: h.name }))}
                className={selectClass}
                onValueChange={(value) => {
                  setHotel(value);
                  setDepartment(null);
                  setTab("roster");
                  resetChoice();
                  scrolled.current = 0;
                  say(null);
                  void load(undefined, { hotel: value, department: null, tab: "roster" });
                }}
              />
            </label>
          )}
          {(d.admin || (d.departments?.length ?? 0) > 1) && tab === "roster" ? (
            <label className={cx("sched-field")}>
              <span>{t("department")}</span>
              <SelectField
                value={d.dept}
                options={(d.departments ?? []).map((x) => ({ value: x.key, label: x.name }))}
                className={selectClass}
                onValueChange={(value) => {
                  setDepartment(value);
                  scrolled.current = 0;
                  say(null);
                  void load("up", { department: value });
                }}
              />
            </label>
          ) : (
            tab !== "manage" && <p className={cx("sched-dept")}>{deptName(d.dept)}</p>
          )}
          <button
            type="button"
            className={cx("sched-plain")}
            onClick={() => {
              say(null);
              void load();
            }}
          >
            {t("refresh")}
          </button>
        </div>
        <div className={cx("sched-month")}>
          <button type="button" className={cx("sched-arrow")} aria-label={t("previousMonth")} onClick={() => changeMonth(moveMonth(month, -1))}>
            {rtl ? "›" : "‹"}
          </button>
          <div className={cx("sched-picker")}>
            <MonthPicker value={month} onChange={changeMonth} />
          </div>
          <button type="button" className={cx("sched-arrow")} aria-label={t("nextMonth")} onClick={() => changeMonth(moveMonth(month, 1))}>
            {rtl ? "‹" : "›"}
          </button>
        </div>
      </div>
    );
  }

  function stats(d: ScheduleView) {
    const year = month.slice(0, 4);
    const own = d.balances.find((b) => b.id === d.me);
    const balance = own?.total ?? 0;
    const pending = used(year, "pending");
    const approved = used(year, "approved");
    const n = (value: number) => f.number.format(value);
    const stat = (label: string, value: string, note: string) => (
      <div key={label}>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    );
    return (
      <div className={cx("sched-stats")}>
        {stat(t("myBalance"), hoursText(f, balance), t(balance === 0 ? "balanceEven" : balance > 0 ? "balanceInFavor" : "balanceOwed"))}
        {stat(
          t("leaveAvailable", { year: n(Number(year)) }),
          t("leaveRemaining", { remaining: n(QUOTA - approved - pending), quota: n(QUOTA) }),
          t("leaveUsed", { approved: n(approved), pending: n(pending) }),
        )}
      </div>
    );
  }

  const selectionText = useRef<HTMLElement>(null);
  const selectionDetails = useRef<HTMLElement>(null);

  function grid(d: ScheduleView) {
    const count = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
    const days = Array.from({ length: count }, (_, i) => {
      const iso = `${month}-${String(i + 1).padStart(2, "0")}`;
      const weekend = [0, 6].includes(dayDate(iso).getUTCDay());
      return { iso, weekend, n: i + 1 };
    });
    const shifts = new Map(d.shifts.map((s) => [s.employee + s.day, s]));
    const holidays = new Set(d.vacations.map((v) => v.employee + v.day));
    const reserved = new Set(d.mine.filter((r) => r.state !== "rejected").flatMap((r) => r.days));
    const people: (Person | Balance)[] = [...d.people];
    if (tab === "leave") {
      const own = d.balances.find((b) => b.id === d.me);
      if (own && !people.some((p) => p.id === own.id)) people.push(own);
      for (const request of d.mine) if (request.state === "approved") for (const date of request.days) holidays.add(d.me + date);
    }
    people.sort(
      (a, b) =>
        positionGroup(a.position) - positionGroup(b.position) ||
        f.collator.compare(positionKey(a.position), positionKey(b.position)) ||
        f.collator.compare(a.name, b.name),
    );
    const timeRange = (shift?: Shift) => {
      if (!shift) return "—";
      if (shift.kind === "off") return t("dayOff");
      const start = shift.starts!.slice(0, 5);
      const end = shift.ends!.slice(0, 5);
      return `${clock(f, start)}–${clock(f, end)}${end < start ? ` (+${f.number.format(1)})` : ""}`;
    };
    return (
      <div
        className={cx("schedule-scroll")}
        tabIndex={0}
        role="region"
        aria-label={t("gridLabel")}
        ref={(el) => {
          if (el && el.dataset.restored !== month + tab) {
            el.dataset.restored = month + tab;
            el.scrollLeft = scrolled.current;
          }
        }}
        onScroll={(e) => (scrolled.current = e.currentTarget.scrollLeft)}
      >
        <table className={cx("schedule-grid")}>
          <caption className={cx("sched-sr")}>
            {capitalize(f.month.format(monthDate(month)))} · {deptName(d.dept)}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t("team")}</th>
              {days.map(({ iso, weekend, n }) => (
                <th
                  key={iso}
                  scope="col"
                  className={cx(weekend && "weekend", iso === today && "is-today")}
                  aria-current={iso === today ? "date" : undefined}
                >
                  <small>{f.weekday.format(dayDate(iso)).replace(".", "")}</small>
                  <strong>{f.number.format(n)}</strong>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id}>
                <th scope="row">
                  <strong>{p.name}</strong>
                  <RoleBadge person={p} />
                </th>
                {days.map(({ iso, weekend }) => {
                  const shift = shifts.get(p.id + iso);
                  const vac = holidays.has(p.id + iso);
                  const mine = tab === "leave" && p.id === d.me;
                  const pend = mine && reserved.has(iso) && !vac;
                  const text = vac ? t("leaveShort") : pend ? t("pendingShort") : timeRange(shift);
                  const interactive = !vac && (mine ? !pend : d.admin && tab === "roster");
                  const aria = `${p.name}, ${f.short.format(dayDate(iso))}, ${
                    vac ? t("leave") : pend ? t("awaitingApproval") : shift ? text : t("unassigned")
                  }`;
                  const selected = mine && interactive && chosen.has(iso);
                  const className = cx(
                    "sched-cell",
                    vac ? "sched-vac" : pend ? "sched-pending" : shift && (shift.kind === "off" ? "sched-off" : "sched-work"),
                    selected && "sched-selected",
                  );
                  const content =
                    vac || pend || !shift || shift.kind === "off" ? (
                      text
                    ) : (
                      <>
                        <span>{clock(f, shift.starts!)}</span>
                        <span>
                          {clock(f, shift.ends!)}
                          {shift.ends! < shift.starts! ? ` +${f.number.format(1)}` : ""}
                        </span>
                      </>
                    );
                  const dataset = tab === "roster" ? { "data-shift-day": iso, "data-employee": p.id } : {};
                  return (
                    <td key={iso} className={cx(weekend && "weekend")}>
                      {interactive ? (
                        <button
                          type="button"
                          className={className}
                          aria-label={aria}
                          title={aria}
                          aria-pressed={mine ? selected : undefined}
                          {...dataset}
                          onClick={(event) => {
                            if (mine) toggleDay(iso, event.currentTarget);
                            else {
                              setDialogStatus(null);
                              setEditing({ kind: "shift", person: p as Person, date: iso, shift });
                            }
                          }}
                        >
                          {content}
                        </button>
                      ) : (
                        <span className={className} aria-label={aria} title={aria} {...dataset}>
                          {content}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function toggleDay(iso: string, cell: HTMLElement) {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(iso)) next.delete(iso);
      else next.add(iso);
      return next;
    });
    requestId.current = crypto.randomUUID();
    afterRender.current = () => sequence([cell, selectionText.current, selectionDetails.current]);
  }

  function selection() {
    const years = new Set([month.slice(0, 4), ...[...chosen].map((day) => day.slice(0, 4))]);
    const details: string[] = [];
    let over = false;
    for (const year of [...years].sort()) {
      const count = [...chosen].filter((day) => day.startsWith(`${year}-`)).length;
      const left = QUOTA - used(year, "pending") - used(year, "approved") - count;
      details.push(
        `${f.number.format(Number(year))} · ${
          left < 0 ? t("overAllowance", { days: f.days.format(-left) }) : t("daysLeft", { count: f.number.format(left) })
        }`,
      );
      if (left < 0) over = true;
    }
    return (
      <div className={cx("sched-selection")}>
        <div>
          <strong ref={selectionText} aria-live="polite">
            {t("daysSelected", { count: f.number.format(chosen.size) })}
          </strong>
          <small ref={selectionDetails}>{details.join(" / ")}</small>
        </div>
        <button
          type="button"
          className={cx("sched-plain")}
          onClick={() => {
            if (!chosen.size) return;
            resetChoice();
            afterRender.current = () => sequence([selectionText.current, selectionDetails.current]);
          }}
        >
          {t("clearSelection")}
        </button>
        <button
          type="button"
          className="btn btn-primary download primary"
          disabled={!chosen.size || over || busy}
          onClick={() => {
            const days = [...chosen].sort();
            const id = requestId.current;
            void write(async () => {
              const result = await requestLeave(hotel, id, days);
              if (result.ok) resetChoice();
              return result;
            }, "requestSent", false);
          }}
        >
          {t("sendRequest")}
        </button>
      </div>
    );
  }

  function requests(items: ScheduleView["requests"] | ScheduleView["mine"], admin: boolean) {
    return (
      <section className={cx("sched-requests")}>
        <h3>{t(admin ? "leaveRequests" : "myRequests")}</h3>
        {!items.length ? (
          <p className={cx("hint")}>{t(admin ? "noRequests" : "noOwnRequests")}</p>
        ) : (
          items.map((request) => (
            <div key={request.id} className={cx("sched-request")} data-request={request.id}>
              <div>
                {admin && "name" in request && (
                  <strong>
                    {request.name} · {request.department}
                  </strong>
                )}
                <p>{ranges(f, request.days)}</p>
                <small>
                  {f.days.format(request.days.length)} · {t(states[request.state])}
                </small>
              </div>
              {admin && request.state === "pending" && (
                <div className={cx("sched-actions")}>
                  {(["approved", "rejected"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={value === "approved" ? "btn btn-primary download primary" : "btn download"}
                      disabled={busy}
                      onClick={() =>
                        void write(
                          () => decideLeave(hotel, request.id, value),
                          value === "approved" ? "requestApproved" : "requestRejected",
                          false,
                          () => {
                            const updated = panel.current?.querySelector(`.sched-request[data-request="${request.id}"]`);
                            const items = updated ? [...(updated.firstElementChild?.children ?? []), noticeRef.current] : [noticeRef.current];
                            sequence(items);
                          },
                        )
                      }
                    >
                      {t(value === "approved" ? "approve" : "reject")}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </section>
    );
  }

  function manage(d: ScheduleView) {
    const rows = [...d.balances].sort(
      (a, b) =>
        f.collator.compare(a.department, b.department) ||
        positionGroup(a.position) - positionGroup(b.position) ||
        f.collator.compare(positionKey(a.position), positionKey(b.position)) ||
        f.collator.compare(a.name, b.name),
    );
    return (
      <section>
        <h2>{t("teamBalances")}</h2>
        <p className={cx("hint")}>{t("teamBalancesHint")}</p>
        <div className={cx("schedule-scroll")}>
          <table className={cx("sched-team-table")}>
            <thead>
              <tr>
                {(["employee", "position", "department", "monthAdjustment", "runningBalance", "action"] as const).map((k) => (
                  <th key={k} scope="col">
                    {t(k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} data-employee={p.id}>
                  <td>{p.name}</td>
                  <td>
                    <RoleBadge person={p} />
                  </td>
                  <td>{p.department}</td>
                  <td>
                    <HourDigits f={f} minutes={p.adjustment} />
                  </td>
                  <td>
                    <HourDigits f={f} minutes={p.total} />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn download"
                      data-adjust-hours=""
                      aria-label={t("adjustFor", { name: p.name })}
                      onClick={() => {
                        setDialogStatus(null);
                        setEditing({ kind: "hours", person: p });
                      }}
                    >
                      {t("adjust")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {requests(d.requests, true)}
      </section>
    );
  }

  // ---- Render ---------------------------------------------------------------
  let body: ReactNode = null;
  if (failed && !data) {
    body = (
      <button type="button" className="btn download" onClick={() => void load()}>
        {t("reload")}
      </button>
    );
  } else if (data) {
    const hint = tab === "leave" ? "leaveHint" : data.admin ? "adminHint" : "staffHint";
    body = (
      <>
        <div className={cx("sched-tabs")} role="group" aria-label={t("views")}>
          {tabs
            .filter(([key]) => key !== "manage" || data.admin)
            .map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={cx("sched-tab")}
                aria-pressed={tab === key}
                onClick={() => {
                  if (saving.current || tab === key) return;
                  setTab(key);
                  scrolled.current = 0;
                  say(null);
                  void load("up", { tab: key });
                }}
              >
                {t(label)}
              </button>
            ))}
        </div>
        {head(data)}
        {stats(data)}
        {tab === "manage" ? (
          manage(data)
        ) : (
          <section>
            <h2>{t(tab === "leave" ? "selectLeave" : "departmentRoster")}</h2>
            <p className={cx("hint")}>{t(hint)}</p>
            {grid(data)}
            {tab === "leave" && (
              <>
                {selection()}
                {requests(data.mine, false)}
              </>
            )}
          </section>
        )}
      </>
    );
  }

  return (
    <section ref={setRootEl} className={cx("root", "schedule")}>
      <p ref={noticeRef} className={cx("schedule-notice", notice?.error && "is-error")} role="status">
        {notice ? t(notice.key, notice.params) : ""}
      </p>
      <div ref={panel} inert={busy || undefined} aria-busy={busy || undefined}>
        {body}
      </div>
      {editing?.kind === "shift" && (
        <ShiftDialog
          container={rootEl}
          f={f}
          editing={editing}
          status={dialogStatus}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(values) => {
            const { person, date, shift } = editing;
            void write(
              () => editShift(hotel, person.id, date, { ...values, previous: shift?.revision ?? null }),
              "shiftSaved",
              true,
              () => {
                const cell = panel.current?.querySelector(`[data-shift-day="${date}"][data-employee="${person.id}"]`);
                if (cell) carbon(...(cell.children.length ? [...cell.children] : [cell]));
              },
            );
          }}
        />
      )}
      {editing?.kind === "hours" && (
        <HoursDialog
          container={rootEl}
          f={f}
          month={month}
          person={editing.person}
          status={dialogStatus}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(minutes) => {
            const person = editing.person;
            void write(() => setBalance(hotel, person.id, month, minutes, person.revision), "balanceSaved", true, () => {
              pulseHours(panel.current?.querySelector(`.sched-team-table tr[data-employee="${person.id}"]`));
            });
          }}
        />
      )}
    </section>
  );
}

/** Native <select> metrics of the legacy form controls, on the Radix select. */
const selectClass = "mt-[.3rem] min-h-[46px] py-[.6rem] text-base/[1.4] font-normal";

function ScheduleDialog({
  container,
  title,
  status,
  busy,
  onClose,
  onSubmit,
  className,
  children,
  onOpen,
}: {
  container: HTMLElement | null;
  title: string;
  status: string | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  className?: string;
  children: ReactNode;
  onOpen?: (content: HTMLElement) => void;
}) {
  const t = useTranslations("Schedule");
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal container={container}>
        <Dialog.Overlay className={cx("schedule-dialog-backdrop")} />
        <Dialog.Content
          className={cx("schedule-dialog", className)}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            const content = event.currentTarget as HTMLElement;
            requestAnimationFrame(() => onOpen?.(content));
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy) onSubmit(event);
            }}
          >
            <fieldset disabled={busy}>
              <Dialog.Title asChild>
                <h2>{title}</h2>
              </Dialog.Title>
              {children}
              <p className="alert-ok feedback" role="status">
                {status ? t(status) : ""}
              </p>
              <div className={cx("sched-actions")}>
                <Dialog.Close type="button" className="btn download">
                  {t("cancel")}
                </Dialog.Close>
                <button type="submit" className="btn btn-primary download primary">
                  {t("save")}
                </button>
              </div>
            </fieldset>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ClockField({
  title,
  value,
  disabled,
  f,
  hourRef,
  minuteRef,
  onChange,
}: {
  title: string;
  value: { hour: string; minute: string };
  disabled: boolean;
  f: Formats;
  hourRef?: React.Ref<HTMLSelectElement>;
  minuteRef?: React.Ref<HTMLSelectElement>;
  onChange: (part: "hour" | "minute", value: string) => void;
}) {
  const t = useTranslations("Schedule");
  const part = (label: string, limit: number, key: "hour" | "minute", ref?: React.Ref<HTMLSelectElement>) => (
    <label className={cx("sched-field")}>
      <span>{label}</span>
      <select ref={ref} value={value[key]} disabled={disabled} required={!disabled} onChange={(e) => onChange(key, e.target.value)}>
        <option value="">—</option>
        {Array.from({ length: limit }, (_, i) => (
          <option key={i} value={String(i).padStart(2, "0")}>
            {f.clockDigit.format(i)}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <fieldset className={cx("sched-clock")}>
      <legend>{title}</legend>
      <div className={cx("sched-clock-fields")}>
        {part(t("hours"), 24, "hour", hourRef)}
        {part(t("minutes"), 60, "minute", minuteRef)}
      </div>
    </fieldset>
  );
}

function ShiftDialog({
  container,
  f,
  editing,
  status,
  busy,
  onClose,
  onSave,
}: {
  container: HTMLElement | null;
  f: Formats;
  editing: Extract<Editing, { kind: "shift" }>;
  status: string | null;
  busy: boolean;
  onClose: () => void;
  onSave: (values: { kind: "work" | "off" | "clear"; start: string | null; end: string | null }) => void;
}) {
  const t = useTranslations("Schedule");
  const { person, date, shift } = editing;
  const split = (time?: string | null) => {
    const [hour = "", minute = ""] = (time ?? "").slice(0, 5).split(":");
    return { hour, minute };
  };
  const [kind, setKind] = useState<"work" | "off" | "clear">(shift?.kind ?? "work");
  const [start, setStart] = useState(() => split(shift?.starts));
  const [end, setEnd] = useState(() => split(shift?.ends));
  const endHour = useRef<HTMLSelectElement>(null);
  const summary = useRef<HTMLParagraphElement>(null);
  const group = useRef<HTMLDivElement>(null);
  const work = kind === "work";
  const clear = () => endHour.current?.setCustomValidity("");

  return (
    <ScheduleDialog
      container={container}
      title={t("editShift")}
      status={status}
      busy={busy}
      onClose={onClose}
      onOpen={(content) => {
        const fields = [...content.querySelectorAll("fieldset>h2,fieldset>p:not(:empty),fieldset>.sched-field,.sched-clock")].filter(
          (el) => !el.closest("[hidden]"),
        );
        carbon(...fields);
      }}
      onSubmit={(event) => {
        const form = event.currentTarget;
        const startTime = start.hour && start.minute ? `${start.hour}:${start.minute}` : "";
        const endTime = end.hour && end.minute ? `${end.hour}:${end.minute}` : "";
        if (work) {
          if (!form.reportValidity()) return;
          if (startTime === endTime) {
            endHour.current?.setCustomValidity(t("endDiffers"));
            endHour.current?.reportValidity();
            return;
          }
        }
        onSave({ kind, start: work ? startTime : null, end: work ? endTime : null });
      }}
    >
      <p ref={summary}>
        {person.name} · {f.dated.format(dayDate(date))}
      </p>
      <label className={cx("sched-field")}>
        <span>{t("type")}</span>
        <SelectField
          value={kind}
          className={selectClass}
          options={[
            { value: "work", label: t("workShift") },
            { value: "off", label: t("offDay") },
            { value: "clear", label: t("unassigned") },
          ]}
          onValueChange={(value) => {
            const next = value as typeof kind;
            setKind(next);
            clear();
            requestAnimationFrame(() => {
              if (next === "work") carbon(...(group.current ? [...group.current.children] : []));
              else carbon(summary.current);
            });
          }}
        />
      </label>
      <div
        ref={group}
        className={cx("sched-time-pair", "sched-shift-times")}
        hidden={!work}
        onInput={clear}
        onChange={(event) => {
          clear();
          const legend = (event.target as Element).closest(".sched-clock")?.querySelector("legend");
          if (legend) carbon(legend);
        }}
      >
        <ClockField title={t("start")} value={start} disabled={!work} f={f} onChange={(k, v) => setStart((s) => ({ ...s, [k]: v }))} />
        <ClockField title={t("end")} value={end} disabled={!work} f={f} hourRef={endHour} onChange={(k, v) => setEnd((s) => ({ ...s, [k]: v }))} />
      </div>
    </ScheduleDialog>
  );
}

function HoursDialog({
  container,
  f,
  month,
  person,
  status,
  busy,
  onClose,
  onSave,
}: {
  container: HTMLElement | null;
  f: Formats;
  month: string;
  person: Balance;
  status: string | null;
  busy: boolean;
  onClose: () => void;
  onSave: (minutes: number) => void;
}) {
  const t = useTranslations("Schedule");
  const initial = Math.abs(person.adjustment);
  const [sign, setSign] = useState(person.adjustment < 0 ? -1 : 1);
  const [hh, setHh] = useState(String(Math.floor(initial / 60)));
  const [mm, setMm] = useState(String(initial % 60));
  const preview = useRef<HTMLElement>(null);
  const before = useRef<string[]>([]);
  const valid = /^\d+$/.test(hh) && /^\d+$/.test(mm) && Number(mm) <= 59;
  const minutes = valid ? sign * (Number(hh) * 60 + Number(mm)) : NaN;

  const remember = () => {
    before.current = [...(preview.current?.querySelectorAll("[data-motion-number]") ?? [])].map((s) => s.textContent ?? "");
  };
  useLayoutEffect(() => {
    if (before.current.length) pulseHours(preview.current, before.current);
    before.current = [];
  }, [minutes]);

  return (
    <ScheduleDialog
      container={container}
      title={t("adjustHours")}
      status={status}
      busy={busy}
      className="sched-hours-dialog"
      onClose={onClose}
      onOpen={() => pulseHours(preview.current?.parentElement)}
      onSubmit={(event) => {
        if (!event.currentTarget.reportValidity()) return;
        onSave(minutes);
      }}
    >
      <p>
        {person.name} · {f.month.format(monthDate(month))}
      </p>
      <label className={cx("sched-field")}>
        <span>{t("adjustDirection")}</span>
        <SelectField
          value={String(sign)}
          className={selectClass}
          options={[
            { value: "1", label: t("hoursInFavor") },
            { value: "-1", label: t("hoursOwed") },
          ]}
          onValueChange={(v) => {
            remember();
            setSign(Number(v));
          }}
        />
      </label>
      <div className={cx("sched-time-pair")} onInput={remember}>
        <label className={cx("sched-field")}>
          <span>{t("hours")}</span>
          <input type="number" min={0} step={1} required value={hh} onChange={(e) => setHh(e.target.value)} />
        </label>
        <label className={cx("sched-field")}>
          <span>{t("minutes")}</span>
          <input type="number" min={0} max={59} step={1} required value={mm} onChange={(e) => setMm(e.target.value)} />
        </label>
      </div>
      <div className={cx("sched-hour-preview")}>
        <span>{t("monthAdjustment")}</span>
        <strong ref={preview}>
          <HourDigits f={f} minutes={minutes} />
        </strong>
      </div>
      <p className={cx("hint")}>{t("adjustHint")}</p>
    </ScheduleDialog>
  );
}
