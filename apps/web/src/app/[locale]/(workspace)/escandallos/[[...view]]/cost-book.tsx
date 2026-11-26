"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { costFigures, defaultCostSettings, numericInput, quantityUnits, unitsCompatible, type CostSettings } from "@compi/shared/costs";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { costOverview, loadCost, loadPlazaTemplate, saveCost } from "@/app/actions/costs";
import { loadGuide } from "@/app/actions/guides";
import { SelectField } from "@/components/select-field";
import { WsIcon } from "@/components/workspace/ws-icon";
import { sequence, tactil } from "@/lib/motion";
import styles from "./costs.module.css";

// Port of legacy cost-book.js + workspace-costs.js (#/escandallos): pick a
// recipe of the catalog, adjust its cost sheet (ingredients, batch and base
// servings, sale price) and see cost per serving, margin and food cost.
// Motion: "filter", "cost-picker", "cost-ingredient", "cost-margin",
// "save-notice" = secuencia; "cost-servings" = tactil.
// TODO(port): the Plaza module (plaza-costs.js + plaza-cost-engine.js). Its
// template loads from /v1/costs/plaza; until it is ported, Plaza dishes are
// not listed (legacy shows "No se pudo cargar Plaza." when the template is missing).

const cx = (...names: (string | false | null | undefined)[]) =>
  names.filter(Boolean).map((n) => `${styles[n as string] ?? ""} ${n}`).join(" ");

export type CostRow = {
  hotelKey: string;
  outletKey: string;
  guideKey: string;
  hotel: string;
  outlet: string;
  title: string;
  state: string;
  kind: "plato" | "elaboracion" | null;
  hasSource: boolean;
  hasImage: boolean;
};
type Status = "empty" | "pending" | "complete" | "provisional" | "unknown";
type Item = { key: string; row: CostRow; title: string; status: Status; count: number | null };

const statusNames: Record<Status, string> = {
  empty: "empty",
  pending: "pending",
  complete: "complete",
  provisional: "provisional",
  unknown: "unknown",
};
const keyOf = (r: CostRow) => JSON.stringify([r.hotelKey, r.outletKey, r.guideKey]);
const restaurantKey = (r: CostRow) => JSON.stringify([r.hotelKey, r.outletKey]);
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const PLAZA_HOTEL = "hotel-arts-barcelona";

function matchesState(item: Item, filter: string) {
  if (!filter) return true;
  if (filter === "loaded") return (item.count ?? 0) > 0;
  if (filter === "pending") return ["pending", "empty", "provisional"].includes(item.status);
  return item.status === filter;
}

function restaurantChoices(rows: CostRow[]) {
  const outlets = new Map<string, CostRow>();
  const names = new Map<string, number>();
  for (const row of rows) outlets.set(restaurantKey(row), row);
  for (const row of outlets.values()) names.set(row.outlet, (names.get(row.outlet) ?? 0) + 1);
  return [...outlets]
    .map(([value, row]) => ({ value, label: (names.get(row.outlet) ?? 0) > 1 ? `${row.outlet} · ${row.hotel}` : row.outlet }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Legacy native select metrics of `.cb-field select`. */
const cbSelect = "mt-0 min-h-11 rounded-[8px] ps-3 pe-[.82rem] py-[9px] text-[14px]/[1.45] font-medium";

export function CostBook({ rows: catalog, plazaAvailable }: { rows: CostRow[]; plazaAvailable: boolean }) {
  const t = useTranslations("Costs");
  const [items, setItems] = useState<Map<string, Item>>(
    () => new Map(catalog.filter((r) => r.state !== "archived").map((row) => [keyOf(row), { key: keyOf(row), row, title: row.title, status: "unknown" as Status, count: null }])),
  );
  const [restaurant, setRestaurant] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [indexFailed, setIndexFailed] = useState(false);
  const [plazaFailed, setPlazaFailed] = useState(false);
  const [plazaBusy, setPlazaBusy] = useState(false);
  const edited = useRef(new Set<string>());
  const countRef = useRef<HTMLParagraphElement>(null);
  const restaurantRef = useRef<HTMLButtonElement>(null);
  const pickRef = useRef<HTMLButtonElement>(null);
  const tariffs = useRef<Promise<Tariff[]> | null>(null);
  const afterRender = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const run = afterRender.current;
    afterRender.current = null;
    run?.();
  });

  const allowed = useMemo(
    () => [...items.values()].filter((item) => (!restaurant || restaurantKey(item.row) === restaurant) && matchesState(item, statusFilter)),
    [items, restaurant, statusFilter],
  );
  const current = selected ? (items.get(selected) ?? null) : null;

  const readIndex = useCallback(async () => {
    setReading(true);
    const keys = catalog.filter((r) => r.state !== "archived").map((r) => ({ h: r.hotelKey, o: r.outletKey, g: r.guideKey }));
    const result = keys.length ? await costOverview(keys) : [];
    setReading(false);
    if (!result) {
      setIndexFailed(true);
      return;
    }
    setIndexFailed(false);
    setItems((all) => {
      const next = new Map(all);
      for (const r of result) {
        const key = JSON.stringify([r.hotelKey, r.outletKey, r.guideKey]);
        const item = next.get(key);
        if (!item || edited.current.has(key)) continue;
        const count = r.settings?.ingredients?.length ?? r.ingredientCount ?? 0;
        next.set(key, { ...item, count, status: !count ? "empty" : r.settings && costFigures(r.settings).complete ? "complete" : "pending" });
      }
      return next;
    });
  }, [catalog]);

  const startPlaza = useCallback(async () => {
    if (!plazaAvailable) return;
    setPlazaBusy(true);
    setPlazaFailed(false);
    const data = await loadPlazaTemplate();
    setPlazaBusy(false);
    if (!data) setPlazaFailed(true);
    // TODO(port): list data.recipes and mount the Plaza module.
  }, [plazaAvailable]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial loads, as legacy renderCostBook()
    void startPlaza().then(readIndex);
  }, [startPlaza, readIndex]);

  // Keep a selection inside the filtered list (legacy choose(allowed[0])).
  useEffect(() => {
    if (!selected || !allowed.some((i) => i.key === selected)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- follows the filters, like legacy applyFilters()
      setSelected(allowed[0]?.key ?? null);
    }
  }, [allowed, selected]);

  const applyFilters = () =>
    (afterRender.current = () => {
      sequence([countRef.current]);
      requestAnimationFrame(() => sequence([document.querySelector(".cb-guide .wc-selected-name")]));
    });

  const loadTariffs = plazaAvailable
    ? () =>
        (tariffs.current ??= loadPlazaTemplate().then((data) => {
          if (!data || !Array.isArray(data.tariffs)) {
            tariffs.current = null;
            throw new Error("Tariffs unavailable");
          }
          return data.tariffs as Tariff[];
        }))
    : null;

  const n = allowed.length;
  const message: ReactNode[] = [];
  if (indexFailed && !reading && catalog.length)
    message.push(
      <span key="i">{t("indexFailed")}</span>,
      " ",
      <button key="ir" type="button" className={cx("cb-plain")} onClick={() => void readIndex()}>
        {t("retry")}
      </button>,
    );
  if (plazaFailed && !plazaBusy)
    message.push(
      <span key="p">{t("plazaFailed")}</span>,
      " ",
      <button key="pr" type="button" className={cx("cb-plain")} onClick={() => void startPlaza()}>
        {t("retry")}
      </button>,
    );

  return (
    <section className={cx("cb-workspace")}>
      <header className={cx("cb-heading")}>
        <h1>{t("title")}</h1>
      </header>
      <div className={cx("cb-filters")}>
        <label className={cx("cb-field")}>
          <span>{t("restaurant")}</span>
          <SelectField
            className={cbSelect}
            value={restaurant}
            options={[{ value: "", label: t("allRestaurants") }, ...restaurantChoices([...items.values()].map((i) => i.row))]}
            onValueChange={(v) => {
              setRestaurant(v);
              applyFilters();
            }}
          />
        </label>
        <label className={cx("cb-field")}>
          <span>{t("costStatus")}</span>
          <SelectField
            className={cbSelect}
            value={statusFilter}
            options={[
              { value: "", label: t("allStatuses") },
              { value: "loaded", label: t("loaded") },
              ...(["empty", "pending", "complete", "provisional"] as const).map((s) => ({ value: s, label: t(statusNames[s]) })),
            ]}
            onValueChange={(v) => {
              setStatusFilter(v);
              applyFilters();
            }}
          />
        </label>
        <button ref={pickRef} type="button" className={cx("cb-pick")} aria-haspopup="dialog" disabled={!n} onClick={() => setPickerOpen(true)}>
          {t("chooseDish")}
        </button>
      </div>
      <p ref={countRef} className={cx("cb-count")} role="status">
        {n === 1 ? t("countOne") : t("countMany", { n })}
      </p>
      <p className={cx("cb-message")} hidden={!message.length}>
        {message}
      </p>
      <button
        ref={restaurantRef}
        type="button"
        className={cx("cb-plain")}
        hidden={n > 0 || (!restaurant && !statusFilter)}
        onClick={() => {
          setRestaurant("");
          setStatusFilter("");
          applyFilters();
        }}
      >
        {t("showAll")}
      </button>
      <div className={cx("cb-plaza")} hidden />
      <div className={cx("cb-guide")} hidden={!current}>
        {current && (
          <GuideCost
            key={current.key}
            row={current.row}
            loadTariffs={current.row.hotelKey === PLAZA_HOTEL ? loadTariffs : null}
            onCost={(count, complete) => {
              edited.current.add(current.key);
              const status: Status = count ? (complete ? "complete" : "pending") : "empty";
              if (current.count !== count || current.status !== status) {
                setItems((all) => new Map(all).set(current.key, { ...current, count, status }));
              }
            }}
          />
        )}
      </div>
      {pickerOpen && (
        <Picker
          title={t("chooseDish")}
          items={allowed}
          selected={selected}
          dialogClass="cb-dialog"
          describe={(item) => [item.row.outlet, t(statusNames[item.status])].filter(Boolean).join(" · ")}
          onPick={(item) => {
            setSelected(item.key);
            setPickerOpen(false);
            afterRender.current = () => requestAnimationFrame(() => sequence([document.querySelector(".cb-guide .wc-selected-name")]));
          }}
          onClose={() => {
            setPickerOpen(false);
            requestAnimationFrame(() => pickRef.current?.focus({ preventScroll: true }));
          }}
        />
      )}
    </section>
  );
}

function CostDialog({ title, onClose, children, className }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  const t = useTranslations("Costs");
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={cx("wc-backdrop")} />
        <Dialog.Content className={cx("wc-dialog", className)} aria-label={title} aria-describedby={undefined}>
          <header>
            <Dialog.Title asChild>
              <h2>{title}</h2>
            </Dialog.Title>
            <Dialog.Close className={cx("wc-icon-btn")} aria-label={t("close")}>
              ×
            </Dialog.Close>
          </header>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Picker({
  title,
  items,
  selected,
  describe,
  onPick,
  onClose,
  dialogClass,
}: {
  title: string;
  items: Item[];
  selected: string | null;
  describe: (item: Item) => string;
  onPick: (item: Item) => void;
  onClose: () => void;
  dialogClass?: string;
}) {
  const t = useTranslations("Costs");
  const [query, setQuery] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const words = fold(query.trim()).split(/\s+/).filter(Boolean);
  const found = items.filter((i) => {
    const haystack = fold(`${i.title} ${i.row.outlet}`);
    return words.every((w) => haystack.includes(w));
  });
  return (
    <CostDialog title={title} onClose={onClose} className={dialogClass}>
      <div className={cx("wc-picker")}>
        <label className={cx("wc-field")}>
          <span>{t("searchRecipe")}</span>
          <input
            type="search"
            autoComplete="off"
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              requestAnimationFrame(() => sequence([...(list.current?.children ?? [])]));
            }}
          />
        </label>
        <div
          ref={(el) => {
            list.current = el;
            if (el && !el.dataset.shown) {
              el.dataset.shown = "1";
              requestAnimationFrame(() => sequence([...el.children]));
            }
          }}
          className={cx("wc-options")}
        >
          {found.length ? (
            found.map((item) => (
              <button key={item.key} type="button" className={cx("wc-option")} data-key={item.key} aria-pressed={selected === item.key} onClick={() => onPick(item)}>
                <span>
                  <strong dir="auto">{item.title}</strong>
                  <small>{describe(item)}</small>
                </span>
              </button>
            ))
          ) : (
            <p className={cx("wc-muted")}>{t("noMatches")}</p>
          )}
        </div>
      </div>
    </CostDialog>
  );
}

// ---- One recipe's cost sheet (legacy renderCosts) ---------------------------

type Draft = {
  settings: CostSettings;
  revision: string | null;
  invalid: Record<string, string>;
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
  servingsEdited?: boolean;
  image: string | null;
};
/** Edited sheets survive switching recipes (legacy `drafts`). */
const drafts = new Map<string, Draft>();

export type Tariff = { reference: string; name: string; supplier?: string; unit: string; unitPrice: number | null; control?: string };

function useMoney() {
  const locale = useLocale();
  return useMemo(
    () => ({
      number: (value: number | null, digits = 2) =>
        value == null ? "—" : new Intl.NumberFormat(locale, { maximumFractionDigits: Math.min(2, digits) }).format(value),
      money: (value: number | null, precision = 2) =>
        value == null
          ? "—"
          : new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: Math.min(2, precision) }).format(value),
    }),
    [locale],
  );
}

function GuideCost({
  row,
  loadTariffs,
  onCost,
}: {
  row: CostRow;
  loadTariffs: (() => Promise<Tariff[]>) | null;
  onCost: (count: number, complete: boolean) => void;
}) {
  const t = useTranslations("Costs");
  const { number, money } = useMoney();
  const key = keyOf(row);
  const [draft, setDraft] = useState<Draft | null>(() => drafts.get(key) ?? null);
  const [failed, setFailed] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(() => {
    const d = drafts.get(key);
    return d?.conflict ? "conflict" : d?.dirty ? "unsaved" : null;
  });
  const [editing, setEditing] = useState<number | null>(null);
  const view = useRef<HTMLElement>(null);
  const afterRender = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const run = afterRender.current;
    afterRender.current = null;
    run?.();
  });

  const caption = [row.kind === "plato" ? t("dish") : row.kind === "elaboracion" ? t("preparation") : t("unclassified"), row.outlet]
    .filter(Boolean)
    .join(" · ");

  const load = useCallback(async () => {
    setFailed(false);
    setDraft(null);
    const answer = await loadCost(row.hotelKey, row.outletKey, row.guideKey);
    if (!answer.ok) {
      setFailed(true);
      return;
    }
    let ingredients = answer.data.ingredientes as { nombre?: unknown; cantidad?: unknown; unidad?: unknown }[];
    let image: string | null = row.hasImage ? `/api/guides/${[row.hotelKey, row.outletKey, row.guideKey].map(encodeURIComponent).join("/")}/media/approved` : null;
    const missing = !answer.data.settings && !ingredients.length;
    if ((missing || !row.hasImage) && !row.hasSource && row.state === "ready") {
      // Published Word-only guides: ingredients and picture come from the original.
      const legacy = await loadGuide({ h: row.hotelKey, o: row.outletKey, g: row.guideKey, state: row.state, hasSource: false, hasImage: false, hasCleanImage: false });
      if (missing) ingredients = (legacy.data.ingredientes as typeof ingredients) ?? [];
      if (!row.hasImage) image = legacy.approvedUrl;
    }
    const settings = answer.data.settings ? structuredClone(answer.data.settings) : defaultCostSettings(ingredients);
    const next: Draft = { settings, revision: answer.data.revision, invalid: {}, dirty: false, saving: false, conflict: false, image };
    drafts.set(key, next);
    setDraft(next);
  }, [key, row]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- opening a recipe loads its sheet (legacy selectRow)
    if (!drafts.has(key)) void load();
  }, [key, load]);

  const s = draft?.settings;
  const figures = s ? costFigures(s) : null;
  useEffect(() => {
    if (s && figures) onCost(s.ingredients.length, figures.complete);
    // Report once per change of the sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);

  const update = (change: (d: Draft) => Draft) =>
    setDraft((d) => {
      if (!d) return d;
      const next = change(d);
      drafts.set(key, next);
      return next;
    });
  const changed = (settings: CostSettings, extra: Partial<Draft> = {}) => {
    update((d) => ({ ...d, ...extra, settings, dirty: true }));
    if (!draft?.conflict) setFeedback("unsaved");
  };
  const pulseServings = () =>
    (afterRender.current = () => {
      const input = view.current?.querySelector<HTMLInputElement>("#wc-servings");
      const target =
        document.activeElement === input
          ? view.current?.querySelector(".wc-batch-count [data-motion-number]")
          : view.current?.querySelector(".wc-stepper-value [data-motion-number]");
      tactil(target);
    });

  const save = async () => {
    if (!draft || !draft.dirty || draft.saving || draft.conflict || Object.keys(draft.invalid).length) return;
    const snapshot = structuredClone(draft.settings);
    update((d) => ({ ...d, saving: true }));
    setFeedback("saving");
    const result = await saveCost(row.hotelKey, row.outletKey, row.guideKey, snapshot, draft.revision);
    const edited = draft.servingsEdited;
    if (result.ok) {
      update((d) => ({ ...d, saving: false, dirty: false, revision: result.data, servingsEdited: false }));
      setFeedback("saved");
    } else {
      update((d) => ({ ...d, saving: false, conflict: Boolean(result.conflict) }));
      setFeedback(result.conflict ? "conflict" : "saveFailed");
    }
    afterRender.current = () => {
      sequence([view.current?.querySelector(".wc-status")]);
      if (result.ok && edited) tactil(view.current?.querySelector(".wc-stepper-value [data-motion-number]"));
    };
  };

  const can = true; // The API serves cost sheets to executive chefs only.
  const disabled = !can || Boolean(draft?.saving);
  const invalid = draft ? Object.keys(draft.invalid).length > 0 : false;
  const saveAction = can && s && (
    <button
      type="button"
      className={cx("wc-button", "wc-primary")}
      data-cost="save"
      disabled={!draft!.dirty || draft!.saving || draft!.conflict || !s.servings || !s.baseServings || invalid}
      onClick={() => void save()}
    >
      <span aria-hidden="true">✓</span> {t("save")}
    </button>
  );
  const recipe = (
    <section className={cx("wc-card", "wc-selected")}>
      <div className={cx("wc-thumb")} aria-hidden="true">
        {draft?.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- private image through the session gateway
          <img alt="" src={draft.image} />
        ) : (
          <WsIcon name="book" className={cx("icon")} />
        )}
      </div>
      <div className={cx("wc-selected-name")}>
        <small>{t("selectedRecipe")}</small>
        <h2 dir="auto">{row.title}</h2>
        <p>{caption}</p>
      </div>
      {saveAction}
    </section>
  );
  const status = (
    <div className={cx("wc-status")} role="status" aria-live="polite">
      {feedback ? t(feedback) : ""}
    </div>
  );

  if (!s || !figures || !draft) {
    return (
      <section ref={view} className={cx("wc-view")}>
        {recipe}
        <p className={cx("wc-empty")} role="status">
          {t(failed ? "loadFailed" : "loading")}{" "}
          {failed && (
            <button type="button" className={cx("wc-button")} onClick={() => void load()}>
              {t("retry")}
            </button>
          )}
        </p>
      </section>
    );
  }

  const numberField = (name: "servings" | "baseServings" | "salePrice", input: HTMLInputElement) => {
    const valid = input.validity.valid;
    const value = input.valueAsNumber;
    const invalidFields = { ...draft.invalid };
    if (valid) delete invalidFields[name];
    else invalidFields[name] = input.value;
    changed({ ...s, [name]: Number.isFinite(value) && valid ? value : null }, { invalid: invalidFields, ...(name === "servings" ? { servingsEdited: true } : {}) });
    if (name === "servings") pulseServings();
    if (name === "salePrice")
      afterRender.current = () =>
        sequence([...(view.current?.querySelectorAll(".wc-summary .wc-ring strong, .wc-summary dd.wc-sale-value, .wc-summary dd.wc-margin-value") ?? [])]);
  };
  const step = (delta: number) => {
    if (disabled) return;
    const servings = Math.min(999, Math.max(1, (s.servings || 1) + delta));
    const invalidFields = { ...draft.invalid };
    delete invalidFields.servings;
    changed({ ...s, servings }, { invalid: invalidFields, servingsEdited: true });
    pulseServings();
  };
  const [before, after = ""] = t(s.servings === 1 ? "servingOne" : "servingMany", { count: "{count}" }).split("{count}");
  const inputValue = (name: "servings" | "baseServings" | "salePrice") => draft.invalid[name] ?? (s[name] ?? "");

  return (
    <section ref={view} className={cx("wc-view")}>
      <div className={cx("wc-panel")}>
        <div className={cx("wc-main")}>
          {recipe}
          <section className={cx("wc-card", "wc-ingredients")}>
            <header>
              <h2>{t("ingredientsAndCosts")}</h2>
              <div className={cx("wc-stepper-wrap")}>
                <label htmlFor="wc-servings">{t("batchServings")}</label>
                <div className={cx("wc-stepper")}>
                  <button type="button" aria-label={t("removeServing")} disabled={disabled || (s.servings ?? 1) <= 1} onClick={() => step(-1)}>
                    −
                  </button>
                  <span className={cx("wc-stepper-value")}>
                    <input
                      id="wc-servings"
                      type="number"
                      min={1}
                      max={999}
                      step={1}
                      required
                      disabled={disabled}
                      value={inputValue("servings")}
                      ref={(el) => el?.setCustomValidity(draft.invalid.servings ? t("invalidNumber") : "")}
                      onChange={(e) => numberField("servings", e.currentTarget)}
                    />
                    <span data-motion-number="" aria-hidden="true">
                      {!draft.invalid.servings && s.servings != null ? number(s.servings, 0) : ""}
                    </span>
                  </span>
                  <button type="button" aria-label={t("addServing")} disabled={disabled || (s.servings ?? 0) >= 999} onClick={() => step(1)}>
                    +
                  </button>
                </div>
              </div>
            </header>
            <div className={cx("wc-table-scroll")} tabIndex={0} role="region" aria-label={t("ingredientsAndCosts")}>
              <table className={cx("wc-table")}>
                <thead>
                  <tr>
                    <th>{t("ingredient")}</th>
                    <th className={cx("wc-num")}>{t("quantity")}</th>
                    <th className={cx("wc-num")}>{t("purchasePrice")}</th>
                    <th className={cx("wc-num")}>{t("batchCost")}</th>
                    <th>
                      <span className={cx("wc-sr")}>{t("editIngredient")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {!s.ingredients.length ? (
                    <tr>
                      <td colSpan={5} className={cx("wc-table-empty")}>
                        {t("noIngredients")}
                      </td>
                    </tr>
                  ) : (
                    s.ingredients.map((item, i) => {
                      const line = figures.rows[i]!;
                      return (
                        <tr key={i}>
                          <th scope="row">
                            <span className={cx("wc-ingredient")} dir="auto">
                              {item.name}
                            </span>
                          </th>
                          <td className={cx("wc-num")}>
                            {number(line.batchQuantity)} <small>{item.unit}</small>
                          </td>
                          <td className={cx("wc-num")}>
                            {money(item.price, 4)}
                            {item.priceUnit && (
                              <>
                                {" "}
                                <small>/ {item.priceUnit}</small>
                              </>
                            )}
                          </td>
                          <td className={cx("wc-num", "wc-line-total")}>{money(line.total)}</td>
                          <td>
                            {!disabled && (
                              <button type="button" className={cx("wc-icon-btn")} aria-label={t("editName", { name: item.name })} onClick={() => setEditing(i)}>
                                <WsIcon name="compose" className={cx("icon")} />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div className={cx("wc-base")}>
              <label className={cx("wc-inline")}>
                {t("baseServings")}{" "}
                <input
                  type="number"
                  min={1}
                  max={999}
                  step={1}
                  required
                  disabled={disabled}
                  value={inputValue("baseServings")}
                  onChange={(e) => numberField("baseServings", e.currentTarget)}
                />
              </label>
              {!disabled && s.ingredients.length < 40 && (
                <button
                  type="button"
                  className={cx("wc-button", s.ingredients.length ? "wc-quiet" : "wc-primary")}
                  onClick={() => setEditing(s.ingredients.length)}
                >
                  + {t(s.ingredients.length ? "addIngredient" : "addIngredients")}
                </button>
              )}
            </div>
            <div className={cx("wc-total")}>
              <div>
                {t("totalBatchCost")}
                <small className={cx("wc-batch-count")}>
                  {before}
                  {s.servings == null ? "—" : <span data-motion-number="">{number(s.servings, 0)}</span>}
                  {after}
                </small>
              </div>
              <strong className={cx("wc-total-value")}>{money(figures.total)}</strong>
            </div>
          </section>
          <section className={cx("wc-card", "wc-price")}>
            <div>
              <span className={cx("wc-symbol")} aria-hidden="true">
                <WsIcon name="cost" className={cx("icon")} />
              </span>
              <h2>{t("salePriceNoVat")}</h2>
            </div>
            <label className={cx("wc-sale-input")}>
              <span className={cx("wc-sr")}>{t("salePriceNoVat")}</span>
              <input
                type="number"
                min={0}
                max={99999.99}
                step={0.01}
                disabled={disabled}
                value={inputValue("salePrice")}
                onChange={(e) => numberField("salePrice", e.currentTarget)}
              />
              <span>€</span>
            </label>
          </section>
        </div>
        <aside className={cx("wc-card", "wc-summary")}>
          <h2>{t("profitability")}</h2>
          <div className={cx("wc-ring")} style={{ "--wc-fill": `${figures.percentage === null ? 0 : Math.min(100, figures.percentage)}%` } as React.CSSProperties}>
            <div>
              <strong>{figures.percentage === null ? "—" : `${number(figures.percentage, 1)} %`}</strong>
              <span>{t("foodCost")}</span>
            </div>
          </div>
          <dl>
            <div>
              <dt>{t("costPerServing")}</dt>
              <dd className={cx("wc-serving-value")}>{money(figures.perServing)}</dd>
            </div>
            <div>
              <dt>{t("salePrice")}</dt>
              <dd className={cx("wc-sale-value")}>{money(figures.sale)}</dd>
            </div>
            <div className={cx("wc-margin")}>
              <dt>{t("grossMargin")}</dt>
              <dd className={cx("wc-margin-value")}>{money(figures.margin)}</dd>
            </div>
          </dl>
          <p className={cx("wc-calculation-note")}>{t(figures.complete ? "amountsNoVat" : "completeToCalculate")}</p>
        </aside>
      </div>
      {status}
      {draft.conflict && (
        <button type="button" className={cx("wc-button")} onClick={() => void load()}>
          {t("reload")}
        </button>
      )}
      {editing !== null && (
        <IngredientEditor
          index={editing}
          settings={s}
          loadTariffs={loadTariffs}
          onClose={() => setEditing(null)}
          onApply={(ingredients) => {
            const index = editing;
            changed({ ...s, ingredients });
            setEditing(null);
            afterRender.current = () => {
              const rows = view.current?.querySelectorAll(".wc-table tbody tr");
              const line = rows?.[Math.min(index, rows.length - 1)];
              if (line) sequence([...line.children]);
            };
          }}
        />
      )}
    </section>
  );
}

/** Two-decimal display that keeps the exact stored amount until edited (legacy cost-precision.js). */
function useAmount(exact: number | null) {
  const display = exact == null ? "" : String(Math.round((exact + Number.EPSILON) * 100) / 100);
  const [state, setState] = useState({ value: display, exact });
  return {
    value: state.value,
    set: (value: string) => setState({ value, exact: null }),
    setExact: (n: number | null) => setState({ value: n == null ? "" : String(Math.round((n + Number.EPSILON) * 100) / 100), exact: n }),
    read: (input: HTMLInputElement | null) =>
      state.exact != null && state.value === String(Math.round((state.exact + Number.EPSILON) * 100) / 100)
        ? state.exact
        : state.value === ""
          ? null
          : (input?.valueAsNumber ?? null),
  };
}

function IngredientEditor({
  index,
  settings,
  loadTariffs,
  onClose,
  onApply,
}: {
  index: number;
  settings: CostSettings;
  loadTariffs: (() => Promise<Tariff[]>) | null;
  onClose: () => void;
  onApply: (ingredients: CostSettings["ingredients"]) => void;
}) {
  const t = useTranslations("Costs");
  const rows = settings.ingredients;
  const adding = index === rows.length;
  const item = adding ? { name: "", quantity: null, unit: "", price: null, priceUnit: "" } : rows[index]!;
  const [name, setName] = useState(item.name);
  const quantity = useAmount(item.quantity);
  const [unit, setUnit] = useState(item.unit);
  const price = useAmount(item.price);
  const [priceUnit, setPriceUnit] = useState(item.priceUnit);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const quantityRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const priceUnitRef = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);

  const field = (key: string, label: string, input: ReactNode) => (
    <label key={key} className={cx("wc-field")}>
      <span>{label}</span>
      {input}
    </label>
  );
  return (
    <CostDialog title={t(adding ? "addIngredient" : "editIngredient")} onClose={onClose}>
      <form
        ref={(el) => {
          form.current = el;
          if (el && !el.dataset.shown) {
            el.dataset.shown = "1";
            requestAnimationFrame(() => sequence([...el.querySelectorAll(".wc-field,footer")]));
            (adding ? nameRef.current : priceRef.current)?.focus();
          }
        }}
        className={cx("wc-editor")}
        onSubmit={(event) => {
          event.preventDefault();
          const entry = {
            name: name.trim(),
            quantity: numericInput(quantity.read(quantityRef.current)),
            unit: unit.trim(),
            price: numericInput(price.read(priceRef.current)),
            priceUnit: priceUnit.trim(),
          };
          if (!entry.name) {
            setError(t("nameRequired"));
            nameRef.current?.focus();
            return;
          }
          if (entry.price !== null && (!entry.priceUnit || (entry.unit && !unitsCompatible(entry.unit, entry.priceUnit)))) {
            setError(t("incompatibleUnits"));
            priceUnitRef.current?.focus();
            return;
          }
          const next = [...rows];
          if (adding) next.push(entry);
          else next[index] = entry;
          onApply(next);
        }}
      >
        {loadTariffs && (
          <TariffPicker
            load={loadTariffs}
            onSelect={(row) => {
              setName(row.name.slice(0, 120));
              price.setExact(Number(Number(row.unitPrice).toFixed(4)));
              setPriceUnit(row.unit);
              if (!unitsCompatible(unit, row.unit)) setUnit(quantityUnits(row.unit)[0] ?? "");
            }}
          />
        )}
        <div className={cx("wc-edit-grid")}>
          {field("name", t("ingredient"), <input ref={nameRef} name="name" type="text" maxLength={120} required value={name} onChange={(e) => setName(e.target.value)} />)}
          {field(
            "quantity",
            t("baseQuantity"),
            <input ref={quantityRef} name="quantity" type="number" min={0} max={999999.9999} step={0.0001} value={quantity.value} onChange={(e) => quantity.set(e.target.value)} />,
          )}
          {field("unit", t("recipeUnit"), <input name="unit" type="text" maxLength={40} list="wc-units" value={unit} onChange={(e) => setUnit(e.target.value)} />)}
          {field(
            "price",
            t("purchasePriceNoVat"),
            <input ref={priceRef} name="price" type="number" min={0} max={99999.9999} step={0.0001} value={price.value} onChange={(e) => price.set(e.target.value)} />,
          )}
          {field(
            "priceUnit",
            t("purchaseUnit"),
            <input ref={priceUnitRef} name="priceUnit" type="text" maxLength={40} list="wc-units" value={priceUnit} onChange={(e) => setPriceUnit(e.target.value)} />,
          )}
        </div>
        <datalist id="wc-units">
          {["g", "kg", "ml", "cl", "l", "ud"].map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
        <p className={cx("wc-form-error")} role="alert">
          {error}
        </p>
        <footer>
          {!adding && (
            <button type="button" className={cx("wc-button", "wc-quiet")} onClick={() => onApply(rows.filter((_, i) => i !== index))}>
              {t("removeIngredient")}
            </button>
          )}
          <button type="submit" className={cx("wc-button", "wc-primary")}>
            {t("apply")}
          </button>
        </footer>
      </form>
    </CostDialog>
  );
}

/** Legacy tariff-picker.js: search the Plaza purchase tariffs and pick one (by reference). */
function TariffPicker({ load, onSelect }: { load: () => Promise<Tariff[]>; onSelect: (row: Tariff) => void }) {
  const t = useTranslations("Costs");
  const locale = useLocale();
  const [tariffs, setTariffs] = useState<Tariff[] | null | "failed">(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  useEffect(() => {
    let live = true;
    load().then(
      (rows) => live && setTariffs(rows),
      () => live && setTariffs("failed"),
    );
    return () => {
      live = false;
    };
  }, [load]);
  if (tariffs === null) return <div className={cx("wc-tariff-picker")}>{t("loadingTariffs")}</div>;
  if (tariffs === "failed") return <div className={cx("wc-tariff-picker")}>{t("tariffsFailed")}</div>;
  const currency = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(n);
  const q = fold(query.trim());
  const matches = tariffs.filter((row) => fold([row.name, row.reference, row.supplier].join(" ")).includes(q));
  return (
    <div className={cx("wc-tariff-picker")}>
      <label className={cx("ec-field", "wc-field")}>
        {t("searchTariffs")}
        <input type="search" placeholder={t("tariffPlaceholder")} value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <label className={cx("ec-field", "wc-field")}>
        {t("tariffProduct")}
        <select
          value={matches.some((m) => m.reference === selected) ? selected : ""}
          onChange={(e) => {
            setSelected(e.target.value);
            const row = tariffs.find((r) => r.reference === e.target.value);
            if (row) onSelect(row);
          }}
        >
          <option value="">{matches.length ? t("selectTariff") : t("noTariffMatches")}</option>
          {matches.map((row) => {
            const price = row.unitPrice ?? 0;
            const cost = price > 0 ? `${currency(price)} / ${row.unit}` : t("pricePending");
            return (
              <option
                key={row.reference}
                value={row.reference}
                disabled={!quantityUnits(row.unit).length || row.control !== "Lista" || !(price > 0)}
              >
                {[row.name, cost, row.supplier, row.reference, row.control !== "Lista" ? row.control : ""].filter(Boolean).join(" · ")}
              </option>
            );
          })}
        </select>
      </label>
      <small>{t("tariffKept")}</small>
    </div>
  );
}
