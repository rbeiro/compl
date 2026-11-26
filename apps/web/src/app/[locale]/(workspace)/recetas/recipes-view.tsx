"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { classifyGuide, loadGuide, type GuideData } from "@/app/actions/guides";
import { SelectField } from "@/components/select-field";
import { Link } from "@/i18n/navigation";
import { duo, panel, sequence } from "@/lib/motion";
import styles from "./recipes.module.css";

// Port of legacy/public/workspace-recipes.js (#/recetas): the recipe book with
// filters, card/list views, per-session favorites, a detail drawer and the
// editors' classification form. Motion as in legacy: "recipe", "recipe-search",
// "recipe-layout", "recipe-classification" = secuencia; "recipe-favorite" =
// duo; "panel" = carbon (sideways).
// TODO(port): localized labels drawn over guide images (guide-language-image.js).

const cx = (...names: (string | false | null | undefined)[]) =>
  names.filter(Boolean).map((n) => `${styles[n as string] ?? ""} ${n}`).join(" ");

export type RecipeRow = {
  hotelKey: string;
  outletKey: string;
  guideKey: string;
  hotel: string;
  outlet: string;
  title: string;
  state: string;
  kind: "plato" | "elaboracion" | null;
  category: string | null;
  canClassify: boolean;
  hasSource: boolean;
  hasImage: boolean;
  hasCleanImage: boolean;
  station?: string | null;
  portion?: string | null;
  pass?: string | null;
  serviceNotes?: string | null;
  englishName?: string | null;
};

const categories = ["desayunos", "entrantes", "principales", "postres", "fondos", "salsas", "bases", "guarniciones", "otros"] as const;
const EMPTY = "__none";
const paths = {
  search: "m20 20-4.5-4.5 M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0",
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  list: "M4 5h2 M9 5h12 M4 12h2 M9 12h12 M4 19h2 M9 19h12",
  heart: "M20.7 4.9a5.4 5.4 0 0 0-7.6 0L12 6l-1.1-1.1a5.4 5.4 0 0 0-7.6 7.6L12 21l8.7-8.5a5.4 5.4 0 0 0 0-7.6z",
  book: "M12 5C9 3 5 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1zm0 0v15",
  arrow: "M4 12h15m-6-6 6 6-6 6",
  plus: "M12 5v14M5 12h14",
  close: "m6 6 12 12M18 6 6 18",
  clock: "M12 7v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 1 1 18 0",
};
const Icon = ({ name }: { name: keyof typeof paths }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={paths[name]} />
  </svg>
);

const rowKey = (r: RecipeRow) => JSON.stringify([r.hotelKey, r.outletKey, r.guideKey]);
const restaurantKey = (r: RecipeRow) => JSON.stringify([r.hotelKey, r.outletKey]);
const folded = (text: unknown) => String(text ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const guidePath = (r: RecipeRow) => [r.hotelKey, r.outletKey, r.guideKey].map(encodeURIComponent).join("/");
/** Approved picture, or the one inside a published Word-only guide. */
const imageUrl = (r: RecipeRow) =>
  r.hasImage ? `/api/guides/${guidePath(r)}/media/approved` : !r.hasSource && r.state === "ready" ? `/api/guides/${guidePath(r)}/legacy/image` : null;

function restaurantChoices(rows: RecipeRow[]) {
  const outlets = new Map<string, RecipeRow>();
  const names = new Map<string, number>();
  for (const row of rows) outlets.set(restaurantKey(row), row);
  for (const row of outlets.values()) names.set(row.outlet, (names.get(row.outlet) ?? 0) + 1);
  return [...outlets]
    .map(([key, row]) => ({ value: key, label: (names.get(row.outlet) ?? 0) > 1 ? `${row.outlet} · ${row.hotel}` : row.outlet }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function Cover({ row }: { row: RecipeRow }) {
  const t = useTranslations("Recipes");
  const c = useTranslations("Categories");
  const [loaded, setLoaded] = useState(false);
  const url = imageUrl(row);
  return (
    <span className={cx("ws-rec-cover", loaded && "has-photo")}>
      {/* Private images through the session gateway; next/image cannot optimize them. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url && <img src={url} alt="" decoding="async" loading="lazy" onLoad={() => setLoaded(true)} hidden={!loaded} />}
      <span className={cx("ws-rec-cover-icon")}>
        <Icon name="book" />
      </span>
      <span className={cx("ws-rec-category")}>{row.category ? c(row.category) : t("unclassified")}</span>
    </span>
  );
}

export function RecipesView({
  rows: initialRows,
  context,
  newRecipeHref,
  favoriteScope,
}: {
  rows: RecipeRow[];
  context: string | null;
  newRecipeHref: string | null;
  favoriteScope: string;
}) {
  const t = useTranslations("Recipes");
  const c = useTranslations("Categories");
  const locale = useLocale();
  const [rows, setRows] = useState(initialRows);
  const [kind, setKind] = useState("");
  const [category, setCategory] = useState("");
  const [restaurant, setRestaurant] = useState("");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set());
  const [open, setOpen] = useState<RecipeRow | null>(null);
  const [rootEl, setRootEl] = useState<HTMLElement | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const afterRender = useRef<(() => void) | null>(null);
  const cardButtons = useRef(new Map<string, HTMLButtonElement>());
  const storage = `compi.recipe-favorites.${favoriteScope}`;

  useLayoutEffect(() => {
    const run = afterRender.current;
    afterRender.current = null;
    run?.();
  });
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storage) ?? "[]");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- favorites live in sessionStorage (legacy)
      if (Array.isArray(saved)) setFavorites(new Set(saved.filter((v) => typeof v === "string")));
    } catch {}
  }, [storage]);

  const kindLabel = (k: string | null) => (k === "plato" ? t("dish") : k === "elaboracion" ? t("preparation") : t("unclassified"));
  const shown = useMemo(() => {
    const needle = folded(query.trim());
    return rows.filter(
      (row) =>
        (!restaurant || restaurantKey(row) === restaurant) &&
        (!kind || (row.kind ?? EMPTY) === kind) &&
        (!category || (row.category ?? EMPTY) === category) &&
        (!needle ||
          [row.title, row.englishName, row.station, row.hotel, row.outlet, row.category ? c(row.category) : t("unclassified")].some((s) =>
            folded(s).includes(needle),
          )),
    );
  }, [rows, restaurant, kind, category, query, c, t]);

  /** Re-render the list, then animate its items (legacy refresh(motion)). */
  const animateGrid = () => (afterRender.current = () => sequence([...(grid.current?.children ?? [])]));

  const toggleFavorite = (row: RecipeRow, button: HTMLButtonElement) => {
    const key = rowKey(row);
    const next = new Set(favorites);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setFavorites(next);
    try {
      sessionStorage.setItem(storage, JSON.stringify([...next]));
    } catch {}
    afterRender.current = () => duo(button.querySelector("svg"), { positive: next.has(key) });
  };

  const types: [string, string][] = [
    ["", t("all")],
    ["plato", t("dishes")],
    ["elaboracion", t("preparations")],
    [EMPTY, t("unclassified")],
  ];
  const n = new Intl.NumberFormat(locale).format(shown.length);

  return (
    <section ref={setRootEl} className={cx("ws-recipes")}>
      <header className={cx("ws-rec-head")}>
        <div>
          {context && (
            <p className={cx("ws-rec-context")} dir="auto">
              {context}
            </p>
          )}
          <h1>{t("title")}</h1>
          <p className={cx("ws-rec-intro")}>{t("intro")}</p>
        </div>
        {newRecipeHref && (
          <Link href={newRecipeHref} className={cx("ws-rec-primary")}>
            <Icon name="plus" />
            <span>{t("newRecipe")}</span>
          </Link>
        )}
      </header>
      <div className={cx("ws-rec-tools")}>
        <div className={cx("ws-rec-types")} role="group" aria-label={t("recipeType")}>
          {types.map(([value, label]) => (
            <button
              key={value || "all"}
              type="button"
              className={cx("ws-rec-type")}
              data-kind={value}
              aria-pressed={value === kind}
              hidden={value === EMPTY && kind !== EMPTY && !rows.some((r) => !r.kind)}
              onClick={() => {
                if (kind === value) return;
                setKind(value);
                animateGrid();
              }}
            >
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className={cx("ws-rec-controls")}>
          <SelectField
            className={cx("ws-rec-category-filter", "ws-rec-outlet-filter")}
            aria-label={t("restaurant")}
            value={restaurant}
            options={[{ value: "", label: t("allRestaurants") }, ...restaurantChoices(rows)]}
            onValueChange={(v) => {
              setRestaurant(v);
              animateGrid();
            }}
          />
          <SelectField
            className={cx("ws-rec-category-filter")}
            aria-label={t("category")}
            value={category}
            options={[
              { value: "", label: t("allCategories") },
              ...categories.map((k) => ({ value: k, label: c(k) })),
              { value: EMPTY, label: t("unclassified") },
            ]}
            onValueChange={(v) => {
              setCategory(v);
              animateGrid();
            }}
          />
          <label className={cx("ws-rec-search")}>
            <Icon name="search" />
            <input
              ref={search}
              type="search"
              aria-label={t("search")}
              placeholder={t("searchPlaceholder")}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                animateGrid();
              }}
            />
          </label>
          <div className={cx("ws-rec-views")} role="group" aria-label={t("viewLabel")}>
            {(["grid", "list"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={cx("ws-rec-view")}
                aria-label={t(mode === "grid" ? "gridView" : "listView")}
                title={t(mode === "grid" ? "gridView" : "listView")}
                aria-pressed={view === mode}
                onClick={() => {
                  if (view === mode) return;
                  setView(mode);
                  animateGrid();
                }}
              >
                <Icon name={mode} />
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className={cx("ws-rec-count")} role="status">
        {t(shown.length === 1 ? "countOne" : "countMany", { n })}
      </p>
      <div ref={grid} className={cx("ws-rec-grid", view === "list" && "ws-rec-list")}>
        {shown.length ? (
          shown.map((row) => {
            const key = rowKey(row);
            const active = favorites.has(key);
            const label = t(active ? "removeFavorite" : "addFavorite", { name: row.title });
            return (
              <article key={key} className={cx("ws-rec-card")}>
                <button
                  ref={(el) => {
                    if (el) cardButtons.current.set(key, el);
                    else cardButtons.current.delete(key);
                  }}
                  type="button"
                  className={cx("ws-rec-open")}
                  aria-label={t("open", { name: row.title })}
                  onClick={() => setOpen(row)}
                >
                  <Cover row={row} />
                  <span className={cx("ws-rec-copy")}>
                    <span className={cx("ws-rec-topline")}>
                      <span className={cx("ws-rec-kind")}>
                        {kindLabel(row.kind)}
                        {row.station && (
                          <>
                            {" · "}
                            <bdi>{row.station}</bdi>
                          </>
                        )}
                      </span>
                      {(row.state === "draft" || row.state === "ready") && (
                        <span className={cx("ws-rec-status", row.state)}>{t(row.state === "draft" ? "draft" : "published")}</span>
                      )}
                    </span>
                    <strong className={cx("ws-rec-title")} dir="auto">
                      {row.title}
                    </strong>
                    {row.serviceNotes && (
                      <span className={cx("ws-rec-description")} dir="auto">
                        {row.serviceNotes}
                      </span>
                    )}
                    <span className={cx("ws-rec-meta")}>
                      {row.pass && (
                        <>
                          <Icon name="clock" />
                          <span dir="auto">{row.pass}</span>
                        </>
                      )}
                      <span className={cx("ws-rec-outlet")} dir="auto">
                        {[row.hotel, row.outlet].filter(Boolean).join(" · ")}
                      </span>
                      <Icon name="arrow" />
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className={cx("ws-rec-favorite")}
                  aria-pressed={active}
                  aria-label={label}
                  title={label}
                  onClick={(e) => toggleFavorite(row, e.currentTarget)}
                >
                  <Icon name="heart" />
                </button>
              </article>
            );
          })
        ) : (
          <div className={cx("ws-rec-empty")}>
            <Icon name={rows.length ? "search" : "book"} />
            <h2>{t(rows.length ? "noMatches" : "empty")}</h2>
            {rows.length > 0 && (
              <button
                type="button"
                className={cx("ws-rec-secondary")}
                onClick={() => {
                  setKind("");
                  setCategory("");
                  setRestaurant("");
                  setQuery("");
                  animateGrid();
                  search.current?.focus();
                }}
              >
                <span>{t("showAll")}</span>
              </button>
            )}
          </div>
        )}
      </div>
      {open && (
        <RecipeDrawer
          row={open}
          container={rootEl}
          kindLabel={kindLabel}
          onClose={() => {
            const key = rowKey(open);
            setOpen(null);
            requestAnimationFrame(() => (cardButtons.current.get(key) ?? search.current)?.focus());
          }}
          onClassified={(kind, category) => {
            setRows((all) => all.map((r) => (rowKey(r) === rowKey(open) ? { ...r, kind, category } : r)));
            setOpen((o) => (o ? { ...o, kind, category } : o));
          }}
        />
      )}
    </section>
  );
}

function RecipeDrawer({
  row,
  container,
  kindLabel,
  onClose,
  onClassified,
}: {
  row: RecipeRow;
  container: HTMLElement | null;
  kindLabel: (kind: string | null) => string;
  onClose: () => void;
  onClassified: (kind: RecipeRow["kind"], category: string | null) => void;
}) {
  const t = useTranslations("Recipes");
  const c = useTranslations("Categories");
  const [data, setData] = useState<GuideData | null>(null);
  const [failed, setFailed] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const footer = useRef<HTMLElement>(null);
  const closing = useRef(false);

  useEffect(() => {
    let live = true;
    void loadGuide({
      h: row.hotelKey,
      o: row.outletKey,
      g: row.guideKey,
      state: row.state,
      hasSource: row.hasSource,
      hasImage: false,
      hasCleanImage: false,
    }).then((result) => {
      if (!live) return;
      if (result.failed) setFailed(true);
      else setData(result.data);
    });
    return () => {
      live = false;
    };
    // The drawer is keyed by its row; reload only when another recipe opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.hotelKey, row.outletKey, row.guideKey]);

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    void panel(content.current, { leaving: true }).then(onClose);
  };

  const d = (data ?? {}) as GuideData & { sala_es?: string; nombre_en?: string; partida?: string; vajilla?: string; ingredientes?: { nombre?: string; cantidad?: string; unidad?: string }[] };
  const facts: [string, string | null | undefined][] = [
    ["hotelOutlet", [row.hotel, row.outlet].filter(Boolean).join(" · ")],
    ["station", d.partida || row.station],
    ["passTime", (d.pase as string) || row.pass],
    ["portion", (d.racion as string) || row.portion],
    ["tableware", d.vajilla],
  ];
  const ingredients = Array.isArray(d.ingredientes) ? d.ingredientes.filter((i) => i.nombre) : [];
  const platingHref = row.state === "ready" ? `/plating/${guidePath(row)}` : null;
  const sheetHref = `/empresa/${[row.hotel, row.outlet, "Plating Guides", row.guideKey].map(encodeURIComponent).join("/")}`;

  return (
    <Dialog.Root open onOpenChange={(o) => !o && close()}>
      <Dialog.Portal container={container}>
        <Dialog.Overlay className={cx("ws-rec-backdrop")} onClick={close} />
        <Dialog.Content
          ref={content}
          className={cx("ws-rec-drawer")}
          aria-describedby={undefined}
          onOpenAutoFocus={() =>
            requestAnimationFrame(() => {
              void panel(content.current);
              sequence([...(body.current?.children ?? []), footer.current]);
            })
          }
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            close();
          }}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <header>
            <Dialog.Title asChild>
              <h2 dir="auto">{row.title}</h2>
            </Dialog.Title>
            <button type="button" className={cx("ws-rec-close")} aria-label={t("close")} title={t("close")} onClick={close}>
              <Icon name="close" />
            </button>
          </header>
          <div ref={body} className={cx("ws-rec-drawer-body")}>
            <Cover row={row} />
            <p className={cx("ws-rec-classification")}>
              <span>{kindLabel(row.kind)}</span>
              {row.category && <span>{c(row.category)}</span>}
            </p>
            <section className={cx("ws-rec-detail-data")}>
              {(d.sala_es || row.serviceNotes) && (
                <p className={cx("ws-rec-detail-desc")} dir="auto">
                  {d.sala_es || row.serviceNotes}
                </p>
              )}
              {d.nombre_en && (
                <p className={cx("ws-rec-detail-en")} dir="auto" data-content-lang="en">
                  {d.nombre_en}
                </p>
              )}
              <dl className={cx("ws-rec-data")}>
                {facts
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <Fact key={k} term={t(k)} value={v!} />
                  ))}
              </dl>
              {ingredients.length > 0 && (
                <>
                  <h3>{t("ingredients")}</h3>
                  <ul>
                    {ingredients.map((i, n) => (
                      <li key={n} dir="auto">
                        {[i.nombre, i.cantidad, i.unidad].filter(Boolean).join(" · ")}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {failed && <p className={cx("ws-rec-save-status")}>{t("detailFailed")}</p>}
            </section>
            {row.canClassify && <Classification row={row} onSaved={onClassified} />}
          </div>
          <footer ref={footer}>
            <Link href={sheetHref} className={cx("ws-rec-primary", "ws-rec-full")}>
              <Icon name="book" />
              <span>{t("openSheet")}</span>
            </Link>
            {platingHref && (
              <Link href={platingHref} className={cx("ws-rec-secondary")}>
                <Icon name="arrow" />
                <span>{t("platingGuide")}</span>
              </Link>
            )}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const Fact = ({ term, value }: { term: string; value: ReactNode }) => (
  <>
    <dt>{term}</dt>
    <dd dir="auto">{value}</dd>
  </>
);

function Classification({ row, onSaved }: { row: RecipeRow; onSaved: (kind: RecipeRow["kind"], category: string | null) => void }) {
  const t = useTranslations("Recipes");
  const c = useTranslations("Categories");
  const [kind, setKind] = useState(row.kind ?? "");
  const [category, setCategory] = useState(row.category ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fields = useRef<HTMLDivElement>(null);
  const save = useRef<HTMLButtonElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  return (
    <details
      className={cx("ws-rec-edit")}
      onToggle={(e) => {
        if (e.currentTarget.open) sequence([...(fields.current?.children ?? []), save.current]);
      }}
    >
      <summary>{t("editClassification")}</summary>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setMessage(null);
          const nextKind = (kind || null) as RecipeRow["kind"];
          const nextCategory = category || null;
          const ok = await classifyGuide(row.hotelKey, row.outletKey, row.guideKey, nextKind, nextCategory);
          setBusy(false);
          if (ok) onSaved(nextKind, nextCategory);
          setMessage(ok ? "classificationSaved" : "classificationFailed");
          if (ok) requestAnimationFrame(() => sequence([status.current]));
        }}
      >
        <div ref={fields} className={cx("ws-rec-edit-fields")}>
          <label>
            <span>{t("recipeType")}</span>
            <SelectField
              value={kind}
              disabled={busy}
              onValueChange={setKind}
              options={[
                { value: "", label: t("unclassified") },
                { value: "plato", label: t("dish") },
                { value: "elaboracion", label: t("preparation") },
              ]}
            />
          </label>
          <label>
            <span>{t("category")}</span>
            <SelectField
              value={category}
              disabled={busy}
              onValueChange={setCategory}
              options={[{ value: "", label: t("unclassified") }, ...categories.map((k) => ({ value: k, label: c(k) }))]}
            />
          </label>
        </div>
        <button ref={save} type="submit" className={cx("ws-rec-secondary")} disabled={busy}>
          {t("saveClassification")}
        </button>
        <p ref={status} className={cx("ws-rec-save-status")} role="status">
          {message ? t(message) : ""}
        </p>
      </form>
    </details>
  );
}
