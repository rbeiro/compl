"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadGuide, setReviewed, type LoadedGuide } from "@/app/actions/guides";
import { SelectField } from "@/components/select-field";
import { duo, sequence } from "@/lib/motion";
import styles from "./plating.module.css";

// Port of legacy/public/workspace-plating.js `renderPlating`.

export type PlatingRow = {
  hotelKey: string;
  outletKey: string;
  guideKey: string;
  hotel: string;
  outlet: string;
  title: string;
  state: string;
  kind: string | null;
  category: string | null;
  reviewed: boolean;
  hasSource: boolean;
  hasImage: boolean;
  hasCleanImage: boolean;
  station: string | null;
  englishName: string | null;
};

const categories = ["desayunos", "entrantes", "principales", "postres", "fondos", "salsas", "bases", "guarniciones", "otros"] as const;
const identity = (row: PlatingRow) => [row.hotelKey, row.outletKey, row.guideKey].join("/");
const restaurantKey = (row: PlatingRow) => JSON.stringify([row.hotelKey, row.outletKey]);
const normalize = (value: unknown) => String(value ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const BATCH = 12;

/** Legacy class name, scoped by the CSS module, plus the raw name as a marker. */
const cx = (...names: (string | false | null | undefined)[]) =>
  names.filter(Boolean).map((n) => `${styles[n as string] ?? ""} ${n}`).join(" ");

const paths: Record<string, string> = {
  search: "M18 18l4 4M19 10a8 8 0 1 1-16 0 8 8 0 1 1 16 0",
  check: "m5 12 4 4L19 6",
  book: "M3 4c4-1 7 0 9 2 2-2 5-3 9-2v15c-4-1-7 0-9 2-2-2-5-3-9-2ZM12 6v15",
  next: "M4 12h15m-6-6 6 6-6 6",
  prev: "m14 6-6 6 6 6",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 1 1 6 0",
  image: "M3 4h18v16H3zM3 16l6-6 5 5 3-3 4 4",
  clock: "M22 12a10 10 0 1 1-20 0 10 10 0 1 1 20 0M12 6v6l4 2",
};
const KitIcon = ({ name }: { name: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={cx("kit-icon")}>
    <path d={paths[name]} />
  </svg>
);

type Entry = LoadedGuide & { loaded: boolean };

export function PlatingView({ rows: initialRows, selectedKey }: { rows: PlatingRow[]; selectedKey: string | null }) {
  const t = useTranslations("Plating");
  const tc = useTranslations("Categories");
  const [rows, setRows] = useState(initialRows);
  const [index, setIndex] = useState(() => Math.max(0, initialRows.findIndex((r) => identity(r) === selectedKey)));
  const [step, setStep] = useState(0);
  const [showLabels, setShowLabels] = useState(true);
  const [outlet, setOutlet] = useState("");
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [acceptedTitle, setAcceptedTitle] = useState<string | null>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [rendered, setRendered] = useState(BATCH);
  const [toast, setToast] = useState("");
  const [reviewing, setReviewing] = useState<Set<string>>(new Set());
  const [entries, setEntries] = useState<Map<string, Entry>>(new Map());
  const [cardVisible, setCardVisible] = useState(true);

  const pending = useRef<ReturnType<typeof setTimeout>>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const reviewRef = useRef<HTMLButtonElement>(null);
  const toastRef = useRef<HTMLParagraphElement>(null);
  const countRef = useRef<HTMLParagraphElement>(null);
  const pictureRef = useRef<HTMLDivElement>(null);
  const toggleTextRef = useRef<HTMLSpanElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const instructionsRef = useRef<HTMLDivElement>(null);
  const requested = useRef(new Set<string>());

  const row = rows[index];
  const record = row ? entries.get(identity(row)) : undefined;

  // ------------------------------------------------------------------ filters
  const categoryName = useCallback(
    (r: PlatingRow) => (r.category && (categories as readonly string[]).includes(r.category) ? tc(r.category) : t("unclassified")),
    [t, tc],
  );
  const computeMatches = useCallback(
    (o: string, c: string, q: string, accepted: string | null) => {
      const words = normalize(q === accepted ? "" : q).trim().split(/\s+/u).filter(Boolean);
      return rows.reduce<number[]>((result, r, n) => {
        const group = r.category && (categories as readonly string[]).includes(r.category) ? r.category : "unclassified";
        if (o && restaurantKey(r) !== o) return result;
        if (c && c !== group && c !== "kind:" + r.kind) return result;
        const haystack = normalize([r.title, r.englishName, r.hotel, r.outlet, r.station, categoryName(r)].filter(Boolean).join(" "));
        if (words.every((w) => haystack.includes(w))) result.push(n);
        return result;
      }, []);
    },
    [rows, categoryName],
  );
  const matches = useMemo(() => computeMatches(outlet, category, query, acceptedTitle), [computeMatches, outlet, category, query, acceptedTitle]);
  const includesCurrent = matches.includes(index);
  const showCard = includesCurrent && cardVisible;

  const restaurantOptions = useMemo(() => {
    const outlets = new Map<string, PlatingRow>();
    for (const r of rows) outlets.set(restaurantKey(r), r);
    const names = new Map<string, number>();
    for (const r of outlets.values()) names.set(r.outlet, (names.get(r.outlet) ?? 0) + 1);
    return [...outlets]
      .map(([key, r]) => ({ value: key, label: (names.get(r.outlet) ?? 0) > 1 ? `${r.outlet} · ${r.hotel}` : r.outlet }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  // ------------------------------------------------------------------ loading
  const ensureLoaded = useCallback(async (r: PlatingRow, force = false) => {
    const key = identity(r);
    if (!force && requested.current.has(key)) return;
    requested.current.add(key);
    const loaded = await loadGuide({
      h: r.hotelKey, o: r.outletKey, g: r.guideKey, state: r.state,
      hasSource: r.hasSource, hasImage: r.hasImage, hasCleanImage: r.hasCleanImage,
    });
    setEntries((prev) => {
      const next = new Map(prev);
      next.delete(key);
      next.set(key, { ...loaded, loaded: true });
      // Keep the five most recent guides, like the legacy cache.
      while (next.size > 5) {
        const oldest = next.keys().next().value!;
        next.delete(oldest);
        requested.current.delete(oldest);
      }
      return next;
    });
    if (loaded.failed) setToast(t("previewFailed"));
  }, [t]);

  useEffect(() => {
    if (row && showCard) void ensureLoaded(row);
  }, [row, showCard, ensureLoaded]);

  const select = useCallback(
    (n: number, focus = false) => {
      const next = rows[n];
      if (!next) return;
      setIndex(n);
      setStep(0);
      setShowLabels(true);
      setCardVisible(true);
      setToast("");
      if (focus) {
        const base = window.location.pathname.replace(/\/plating(\/.*)?$/, "/plating");
        window.history.replaceState(window.history.state, "", `${base}/${[next.hotelKey, next.outletKey, next.guideKey].map(encodeURIComponent).join("/")}`);
        requestAnimationFrame(() => sequence(Array.from(titleRef.current?.children ?? [])));
      }
    },
    [rows],
  );

  // ------------------------------------------------------------------ search
  const hideSuggestions = () => {
    setPopupOpen(false);
    setActive(-1);
  };
  const openSearch = () => {
    if (popupOpen) return;
    setRendered(BATCH);
    setActive(-1);
    setPopupOpen(true);
    requestAnimationFrame(() => {
      if (suggestionsRef.current) suggestionsRef.current.scrollTop = 0;
      const items = suggestionsRef.current?.parentElement?.querySelectorAll("[role=option], p");
      sequence(Array.from(items ?? []));
    });
  };
  const commit = (position: number) => {
    const next = matches[position];
    if (next === undefined) return;
    clearTimeout(pending.current);
    setAcceptedTitle(rows[next]!.title);
    setQuery(rows[next]!.title);
    if (next !== index || !showCard) select(next, true);
    hideSuggestions();
  };
  const highlight = (position: number) => {
    if (!matches.length) return;
    const clamped = Math.max(0, Math.min(position, matches.length - 1));
    if (clamped >= rendered) setRendered(clamped + BATCH);
    setActive(clamped);
    requestAnimationFrame(() => {
      const list = suggestionsRef.current;
      const item = list?.children[clamped] as HTMLElement | undefined;
      if (!list || !item) return;
      if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
      else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
        list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
      }
    });
  };
  const onInput = (value: string) => {
    setQuery(value);
    setAcceptedTitle(null);
    setRendered(BATCH);
    setActive(-1);
    setPopupOpen(true);
  };
  // A unique match is opened after a short pause, as in the legacy portal.
  useEffect(() => {
    clearTimeout(pending.current);
    if (acceptedTitle !== null || !query || matches.length !== 1) return;
    const unique = matches[0]!;
    pending.current = setTimeout(() => {
      hideSuggestions();
      if (index !== unique || !showCard) select(unique, true);
    }, 180);
    return () => clearTimeout(pending.current);
  }, [query, matches, acceptedTitle, index, showCard, select]);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!toolsRef.current?.contains(event.target as Node)) hideSuggestions();
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, []);

  const changeFilter = (which: "outlet" | "category", value: string) => {
    const nextQuery = acceptedTitle !== null ? "" : query;
    if (acceptedTitle !== null) {
      setQuery("");
      setAcceptedTitle(null);
    }
    if (which === "outlet") setOutlet(value);
    else setCategory(value);
    hideSuggestions();
    // The current guide filtered out: open the first match instead.
    const next = computeMatches(which === "outlet" ? value : outlet, which === "category" ? value : category, nextQuery, null);
    if (next.length && !next.includes(index)) select(next[0]!, true);
    if (next.length) requestAnimationFrame(() => sequence([countRef.current]));
  };

  // ------------------------------------------------------------------ review
  const mark = async (reviewed: boolean) => {
    if (!row) return;
    const key = identity(row);
    if (reviewing.has(key)) return;
    setReviewing((s) => new Set(s).add(key));
    const result = await setReviewed(row.hotelKey, row.outletKey, row.guideKey, reviewed).catch(() => null);
    setReviewing((s) => {
      const next = new Set(s);
      next.delete(key);
      return next;
    });
    if (result === null) {
      setToast(t("reviewFailed"));
      return;
    }
    setRows((prev) => prev.map((r) => (identity(r) === key ? { ...r, reviewed: result } : r)));
    setToast(result ? t("markedReviewed") : t("reviewRemoved"));
    duo(reviewRef.current, { positive: result });
    requestAnimationFrame(() => sequence([toastRef.current]));
  };

  // ------------------------------------------------------------------ steps
  const steps = record?.data.pasos ?? [];
  const current = Math.min(step, Math.max(0, steps.length - 1));
  const jump = (n: number, focus: "step" | "next" | "prev") => {
    if (n === current) return;
    const last = current;
    setStep(n);
    requestAnimationFrame(() => {
      const items = instructionsRef.current?.querySelectorAll(".kit-step");
      sequence([items?.[last], items?.[n], instructionsRef.current?.querySelector("progress")]);
      const nav = instructionsRef.current?.querySelector(".kit-guide-navigation");
      const target =
        focus === "step"
          ? instructionsRef.current?.querySelector<HTMLElement>(".kit-step.current")
          : nav?.querySelector<HTMLButtonElement>(focus === "next" ? "button:last-child" : "button:first-child");
      ((target as HTMLButtonElement | null)?.disabled
        ? instructionsRef.current?.querySelector<HTMLElement>(".kit-step.current")
        : target
      )?.focus({ preventScroll: true });
    });
  };

  // ------------------------------------------------------------------ picture
  const cleanAvailable = Boolean(row?.hasCleanImage && record?.approvedUrl);
  const pictureUrl = !showLabels && record?.cleanUrl ? record.cleanUrl : record?.approvedUrl ?? null;
  const [previousPicture, setPreviousPicture] = useState<string | null>(null);
  const toggleLabels = () => {
    if (!cleanAvailable) return;
    setPreviousPicture(pictureUrl);
    setShowLabels((v) => !v);
  };
  const onPictureLoad = () => {
    if (!previousPicture) return;
    const img = pictureRef.current?.querySelector<HTMLImageElement>("img:not([aria-hidden])");
    sequence([img, toggleTextRef.current], { stillImages: true });
    setTimeout(() => setPreviousPicture(null), 420);
  };

  const countText = matches.length === 1 ? t("countOne") : t("countMany", { n: matches.length });
  const basicText = !rows.length ? t("empty") : matches.length ? t("choose") : t("noMatches");
  const visible = matches.slice(0, rendered);
  const optionId = (n: number) => `kit-guide-option-${n}`;

  return (
    <section className={cx("root", "ws-plating")} translate="no">
      <header className={cx("kit-page-head")}>
        <div>
          <div className={cx("kit-eyebrow")}>{row && showCard ? `${t("kitchen")} / ${row.outlet}` : t("kitchen")}</div>
          <h1 className={cx("kit-page-title")}>{t("title")}</h1>
          <p className={cx("kit-page-desc")}>{t("intro")}</p>
        </div>
        {rows.length > 0 && row && (
          <button
            ref={reviewRef}
            type="button"
            hidden={!showCard}
            className={cx("kit-btn", "kit-primary", "kit-review")}
            disabled={reviewing.has(identity(row))}
            aria-pressed={row.reviewed}
            onClick={() => mark(!row.reviewed)}
          >
            <KitIcon name="check" />
            <span>{row.reviewed ? t("reviewed") : t("markReviewed")}</span>
          </button>
        )}
      </header>
      <p ref={toastRef} role="status" className={cx("kit-message")}>
        {toast}
      </p>

      <div
        ref={toolsRef}
        className={cx("kit-guide-filter")}
        onBlur={(event) => {
          if (!toolsRef.current?.contains(event.relatedTarget as Node)) hideSuggestions();
        }}
      >
        <label className={cx("kit-filter-field")}>
          <span>{t("restaurant")}</span>
          <SelectField
            value={outlet}
            onValueChange={(v) => changeFilter("outlet", v)}
            aria-label={t("restaurant")}
            className="rounded-[9px] px-[11px] py-[9px] text-[13px]/[1.5] font-medium"
            options={[{ value: "", label: t("allRestaurants") }, ...restaurantOptions]}
          />
        </label>
        <label className={cx("kit-filter-field")}>
          <span>{t("classification")}</span>
          <SelectField
            value={category}
            onValueChange={(v) => changeFilter("category", v)}
            aria-label={t("classification")}
            className="rounded-[9px] px-[11px] py-[9px] text-[13px]/[1.5] font-medium"
            options={[
              { value: "", label: t("allClassifications") },
              { value: "kind:plato", label: t("dishes") },
              { value: "kind:elaboracion", label: t("preparations") },
              ...categories.map((c) => ({ value: c, label: tc(c) })),
              { value: "unclassified", label: t("unclassified") },
            ]}
          />
        </label>
        <div className={cx("kit-filter-field", "kit-search-field")}>
          <label htmlFor="kit-plating-search">{t("search")}</label>
          <span className={cx("kit-guide-search")}>
            <KitIcon name="search" />
            <input
              ref={searchRef}
              id="kit-plating-search"
              type="search"
              autoComplete="off"
              role="combobox"
              aria-autocomplete="list"
              aria-haspopup="listbox"
              aria-expanded={popupOpen}
              aria-controls="kit-plating-suggestions"
              aria-activedescendant={active >= 0 ? optionId(active) : undefined}
              placeholder={t("searchPlaceholder")}
              value={query}
              onChange={(e) => onInput(e.target.value)}
              onFocus={(e) => {
                if (query === acceptedTitle) e.target.select();
                openSearch();
              }}
              onClick={openSearch}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Escape" && popupOpen) {
                  event.preventDefault();
                  clearTimeout(pending.current);
                  hideSuggestions();
                } else if (event.key === "Tab") hideSuggestions();
                else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  openSearch();
                  const down = event.key === "ArrowDown";
                  highlight(active === -1 ? (down ? 0 : matches.length - 1) : active + (down ? 1 : -1));
                } else if (event.key === "Enter" && popupOpen && matches.length) {
                  event.preventDefault();
                  commit(active < 0 ? 0 : active);
                }
              }}
            />
          </span>
          <div className={cx("kit-guide-popup")} hidden={!popupOpen}>
            <div
              ref={suggestionsRef}
              id="kit-plating-suggestions"
              role="listbox"
              aria-label={t("guides")}
              className={cx("kit-guide-suggestions")}
              onScroll={(e) => {
                const el = e.currentTarget;
                if (rendered < matches.length && el.scrollTop + el.clientHeight >= el.scrollHeight - 12) setRendered(rendered + BATCH);
              }}
              onMouseDown={(e) => e.preventDefault()}
              onPointerDown={() => clearTimeout(pending.current)}
            >
              {visible.map((n, position) => {
                const r = rows[n]!;
                return (
                  <div
                    key={identity(r)}
                    id={optionId(position)}
                    role="option"
                    aria-selected={position === active}
                    aria-posinset={position + 1}
                    aria-setsize={matches.length}
                    className={cx("kit-guide-option")}
                    onClick={() => {
                      commit(position);
                      searchRef.current?.focus({ preventScroll: true });
                    }}
                  >
                    <span>{r.title}</span>
                    <small>{[r.outlet, r.hotel].filter(Boolean).join(" · ")}</small>
                  </div>
                );
              })}
            </div>
            <p className={cx("kit-suggestion-hint")} hidden={!!matches.length && rendered >= matches.length}>
              {matches.length ? t("refine") : t("noMatches")}
            </p>
          </div>
        </div>
      </div>
      <p ref={countRef} role="status" aria-live="polite" className={cx("kit-filter-info")}>
        {countText}
      </p>
      <p className={cx("kit-empty")} hidden={showCard}>
        {basicText}
      </p>

      {row && (
        <section className={cx("kit-guide-workspace")} hidden={!showCard}>
          <div className={cx("kit-guide-top")}>
            <div ref={titleRef}>
              <span className={cx("kit-eyebrow")}>
                {t("platingGuide")} · {row.state === "draft" ? t("draft") : t("published")}
              </span>
              <h2 dir="auto">{row.title}</h2>
            </div>
            <div className={cx("kit-guide-actions")}>
              <a
                className={cx("kit-btn", "kit-primary", "kit-document")}
                href={`/empresa/${[row.hotel, row.outlet, "Plating Guides", row.guideKey].map(encodeURIComponent).join("/")}`}
              >
                <KitIcon name="book" />
                <span>{t("openDocument")}</span>
              </a>
              <button
                type="button"
                className={cx("kit-btn", "kit-secondary", "kit-label-toggle")}
                disabled={!cleanAvailable}
                aria-pressed={cleanAvailable && showLabels}
                title={cleanAvailable ? t("toggleTitle") : t("noCleanTitle")}
                onClick={toggleLabels}
              >
                <KitIcon name="eye" />
                <span ref={toggleTextRef}>{showLabels ? t("hideLabels") : t("showLabels")}</span>
                <span aria-hidden="true" className={cx("kit-switch", cleanAvailable && showLabels && "on")} />
              </button>
            </div>
          </div>
          <div className={cx("kit-guide-columns")}>
            <div ref={pictureRef} className={cx("kit-guide-picture")}>
              {previousPicture && previousPicture !== pictureUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- authenticated image from the API gateway
                <img src={previousPicture} alt="" aria-hidden="true" />
              )}
              {pictureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- authenticated image from the API gateway
                <img
                  key={pictureUrl}
                  src={pictureUrl}
                  alt={row.title}
                  onLoad={onPictureLoad}
                  onError={() => {
                    setPreviousPicture(null);
                    if (!showLabels) setToast(t("imageFailed"));
                  }}
                />
              ) : (
                <div className={cx("kit-picture-placeholder")}>
                  <KitIcon name="image" />
                  <span>{record?.loaded ? t("noPreview") : t("loading")}</span>
                  {record?.failed && (
                    <button type="button" className={cx("kit-btn", "kit-secondary")} onClick={() => ensureLoaded(row, true)}>
                      <span>{t("retry")}</span>
                    </button>
                  )}
                </div>
              )}
            </div>
            <div ref={instructionsRef} className={cx("kit-guide-instructions")}>
              <div className={cx("kit-guide-step-header")}>
                <span className={cx("kit-eyebrow")}>{t("sequence")}</span>
                {steps.length > 0 && <span>{`${current + 1} / ${steps.length}`}</span>}
              </div>
              {!steps.length ? (
                <p className={cx("kit-no-steps")}>{record?.loaded ? t("stepsInDocument") : t("loading")}</p>
              ) : (
                <>
                  <div className={cx("kit-steps")}>
                    {steps.map((s, n) => (
                      <button
                        key={n}
                        type="button"
                        aria-pressed={n === current}
                        className={cx("kit-step", n === current && "current", n < current && "completed")}
                        onClick={() => jump(n, "step")}
                      >
                        <span className={cx("kit-step-number")}>{n < current ? <KitIcon name="check" /> : String(n + 1).padStart(2, "0")}</span>
                        <span dir="auto">
                          <strong>{s.accion}</strong>
                          {s.control && (
                            <span className={cx("kit-step-description")} hidden={n !== current}>
                              {s.control}
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className={cx("kit-guide-bottom")}>
                    <progress className={cx("kit-guide-progress")} max={steps.length} value={current + 1} aria-label={t("sequence")} />
                    <div className={cx("kit-guide-navigation")}>
                      <button
                        type="button"
                        className={cx("kit-plain-icon")}
                        aria-label={t("previousStep")}
                        disabled={current === 0}
                        onClick={() => jump(current - 1, "prev")}
                      >
                        <KitIcon name="prev" />
                      </button>
                      {current === steps.length - 1 ? (
                        <button
                          type="button"
                          className={cx("kit-btn", "kit-primary")}
                          disabled={row.reviewed || reviewing.has(identity(row))}
                          onClick={() => mark(true)}
                        >
                          <span>{row.reviewed ? t("reviewed") : t("finishReview")}</span>
                          <KitIcon name="check" />
                        </button>
                      ) : (
                        <button type="button" className={cx("kit-btn", "kit-primary")} onClick={() => jump(current + 1, "next")}>
                          <span>{t("nextStep")}</span>
                          <KitIcon name="next" />
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
          <footer className={cx("kit-guide-footer")}>
            {record?.data.pase && (
              <span>
                <KitIcon name="clock" />
                <span>{`${t("passTime")} · ${record.data.pase}`}</span>
              </span>
            )}
            {record?.data.racion && (
              <span>
                <KitIcon name="book" />
                <span>{`${t("portion")} · ${record.data.racion}`}</span>
              </span>
            )}
            <span className={cx("kit-footer-reference")}>
              {[row.outlet, record?.data.version ? `${t("version")} ${record.data.version}` : ""].filter(Boolean).join(" · ")}
            </span>
          </footer>
        </section>
      )}
    </section>
  );
}
