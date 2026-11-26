"use client";

import { useLocale, useTranslations } from "next-intl";
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { brandRevision } from "@/app/actions/guides";
import { reserveDraft, saveSource } from "@/app/actions/generator";
import { DatePicker } from "@/components/pickers/date-picker";
import { SelectField } from "@/components/select-field";
import { Link } from "@/i18n/navigation";
import { carbon, sequence } from "@/lib/motion";
import styles from "./generator.module.css";
import { PlatingAssistant, type Media, type PlatingHandle } from "./plating-assistant";

// Port of legacy/public/generator.js (#/generar): recipe form with contextual
// help, ingredient and step rows, plating photo/watercolour, review, Word/PDF
// generation and saving as a draft in Plating Guides. Motion: "recipe-help",
// "ingredient-*", "step-*", "grow-notes", "review-draft" = carbon;
// "generate-files", "generation-error", "draft-library" = secuencia.

const cx = (...names: (string | false | null | undefined)[]) =>
  names.filter(Boolean).map((n) => `${styles[n as string] ?? ""} ${n}`).join(" ");

export type Destination = { hotelKey: string; outletKey: string; hotel: string; outlet: string };
export type InitialSource = { guideKey: string; revision: string; data: Record<string, unknown>; media: Partial<Media> & Record<string, unknown> };

type FieldSpec = [key: string, label: string, max: number, type?: "date" | "textarea"];
const dishFields: FieldSpec[] = [
  ["nombre_es", "nombreDelPlato", 120],
  ["codigo", "codigo", 60],
  ["version", "version", 24],
  ["fecha", "fecha", 12, "date"],
  ["partida", "partida", 80],
  ["racion", "racionYUnidad", 60],
  ["pase", "tiempoDePase", 60],
  ["vajilla", "vajilla", 120],
];
const serviceFields: FieldSpec[] = [
  ["sala_es", "descripcionParaSala", 600, "textarea"],
  ["canal_zona", "canalYZona", 160],
  ["servicio_exterior", "servicioExterior", 160],
  ["contiene", "alergenosConfirmados", 260],
  ["trazas", "trazas", 260],
  ["adaptaciones", "adaptaciones", 260],
];
const ingredientSpecs: FieldSpec[] = [
  ["nombre", "ingrediente", 120],
  ["cantidad", "cantidad", 40],
  ["unidad", "unidad", 40],
];
const stepSpecs: FieldSpec[] = [
  ["accion", "accionDeEmplatado", 600, "textarea"],
  ["control", "observaciones", 300, "textarea"],
];
type Row = Record<string, string> & { id: string };
/** A row's fields without its client-side id. */
const fieldsOf = (row: Row) => Object.fromEntries(Object.entries(row).filter(([k]) => k !== "id"));
const newRow = (values: Record<string, unknown> = {}): Row => {
  const row: Row = { id: crypto.randomUUID() } as Row;
  for (const [k, v] of Object.entries(values)) if (typeof v === "string") row[k] = v;
  return row;
};

const GUIDE_MESSAGES: Record<string, string> = {
  "Reduce el tamaño de la foto.": "reduceElTamanoDe",
  "Faltan los datos del plato.": "faltanLosDatosDel",
  "Los datos del plato no tienen un formato válido.": "losDatosDelPlato",
  "No se pudo generar la ficha. Vuelve a intentarlo.": "noSePudoGenerar",
  "Revisa la longitud y los caracteres de los campos.": "revisaLaLongitudY",
  "Hay una fila sin completar.": "hayUnaFilaSin",
  "Introduce un nombre de plato válido, sin barras.": "introduceUnNombreDe",
  "La foto debe ser una imagen JPEG de hasta 1,8 MB.": "laFotoDebeSer",
  "No se ha podido leer la fotografía.": "noSeHaPodido2",
  "Las dimensiones de la foto son demasiado grandes.": "lasDimensionesDeLa",
  "Esta generación ya corresponde a otro borrador.": "estaGeneracionYaCorresponde",
  "El borrador ya se ha publicado o retirado.": "elBorradorYaSe",
  "Tu cuenta no tiene permiso de edición en este outlet.": "tuCuentaNoTiene",
  "Completa el nombre, cada ingrediente y cada paso. El nombre del plato no puede incluir barras.": "completaElNombreCada",
  "La carga está incompleta. Pulsa Guardar como borrador para continuar.": "laCargaEstaIncompleta",
};
type Feedback = { key: string; params?: Record<string, string> };
class GeneratorError extends Error {
  constructor(
    readonly status: number,
    readonly detail?: string,
  ) {
    super(detail ?? "failed");
  }
}

/** Legacy generator.js feedback(error). */
function feedbackFor(error: unknown, locale: string): Feedback {
  const e = error as { status?: number; detail?: string; message?: string };
  const detail = e.detail || e.message || "";
  const count = /^Indica al menos una fila y respeta el máximo de (\d+)\.$/.exec(detail);
  const character = /^El PDF no admite el carácter «(.+)»\.$/u.exec(detail);
  if (e.status === 403) return { key: "tuCuentaNoTiene" };
  if (e.status === 401) return { key: "laSesionHaCaducado" };
  if (count) return { key: "indicaAlMenosUna", params: { max: new Intl.NumberFormat(locale).format(Number(count[1])) } };
  if (character) return { key: "elPdfNoAdmite", params: { char: character[1]! } };
  return { key: GUIDE_MESSAGES[detail] ?? "noSePudoCompletar" };
}

async function postJson(path: string, payload: unknown, signal?: AbortSignal) {
  const response = await fetch(`/api/generator/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = Object.assign(new GeneratorError(response.status, body?.error?.detail ?? body?.message), { code: body?.error });
    throw error;
  }
  return body as Record<string, unknown>;
}
const b64ToBlob = (encoded: string, type: string) => new Blob([Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))], { type });
async function fingerprint(blob: Blob) {
  const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
const MIME = { docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pdf: "application/pdf" } as const;

/** Legacy guide-source.js saveGuideSource(): upload assets, stage both files, then commit the source. */
async function saveGuideSource(dest: Destination, g: string, data: Record<string, unknown>, media: Partial<Media>, files: Record<"docx" | "pdf", Blob>, previous: string | null) {
  const base = `/api/guides/${[dest.hotelKey, dest.outletKey, g].map(encodeURIComponent).join("/")}`;
  const put = async (path: string, body: Blob, method = "PUT") => {
    const response = await fetch(`${base}/${path}`, { method, body, headers: { "Content-Type": "application/octet-stream" } });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new GeneratorError(response.status, json?.error?.detail);
    return json as { sha256: string; ruta: string; name?: string };
  };
  const mediaFields: Record<string, unknown> = { ...media };
  const assets: Record<string, { sha256: string; ruta: string; name?: string }> = {};
  for (const slot of ["original", "photo", "art", "image"] as const) {
    const value = mediaFields[slot];
    delete mediaFields[slot];
    if (!value) continue;
    const upload = slot === "original" ? (value as File) : b64ToBlob(value as string, slot === "photo" ? "image/jpeg" : "image/png");
    assets[slot] = await put(`source/${slot}`, upload);
    if (slot === "original") assets.original!.name = (value as File).name || "foto";
  }
  delete mediaFields.checked;
  const { foto, imagen_aprobada, ...recipe } = data as { foto?: string; imagen_aprobada?: { sha256: string } };
  const chosen = media.kind === "acuarela" ? assets.image : assets.photo;
  const approved = chosen ? { tipo: media.kind === "acuarela" ? "acuarela" : "foto", ruta: chosen.ruta, sha256: chosen.sha256 } : null;
  if (Boolean(foto) !== Boolean(approved) || (approved && imagen_aprobada && imagen_aprobada.sha256 !== approved.sha256)) {
    throw new GeneratorError(422, "No se ha podido leer la fotografía.");
  }
  const source = { data: recipe, media: mediaFields, assets, imagen_aprobada: approved };
  const [docx, pdf] = await Promise.all((["docx", "pdf"] as const).map(async (f) => (await put(`stage/${f}`, files[f], "POST")).sha256));
  const saved = await saveSource(dest.hotelKey, dest.outletKey, g, { source, docx: docx!, pdf: pdf!, previous });
  if (!saved.ok) throw new GeneratorError(saved.status, saved.detail);
}

export function RecipeGenerator({
  destinations,
  selected,
  initialSource,
}: {
  destinations: Destination[];
  selected: number | null;
  initialSource?: InitialSource;
}) {
  const t = useTranslations("Generator");
  const help = useTranslations("GeneratorHelp");
  const locale = useLocale();
  const [dest, setDest] = useState(selected !== null ? String(selected) : destinations.length === 1 ? "0" : "");
  const [lockedDest, setLockedDest] = useState(!!initialSource);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const data = initialSource?.data ?? {};
    return Object.fromEntries([...dishFields, ...serviceFields].map(([k]) => [k, typeof data[k] === "string" ? (data[k] as string) : ""]));
  });
  const [ingredients, setIngredients] = useState<Row[]>(() => {
    const rows = (initialSource?.data.ingredientes as Record<string, unknown>[] | undefined) ?? [];
    return rows.length ? rows.map(newRow) : [newRow()];
  });
  const [steps, setSteps] = useState<Row[]>(() => {
    const rows = (initialSource?.data.pasos as Record<string, unknown>[] | undefined) ?? [];
    return rows.length ? rows.map(newRow) : [newRow()];
  });
  const [helpAll, setHelpAll] = useState(false);
  const [mode, setMode] = useState<"form" | "review" | "generated">("form");
  const [review, setReview] = useState<{ data: Record<string, unknown>; media: Media | null; destination: Destination } | null>(null);
  const [status, setStatus] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [probeFailed, setProbeFailed] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const plating = useRef<PlatingHandle>(null);
  const form = useRef<HTMLFormElement>(null);
  const general = useRef<HTMLFieldSetElement>(null);
  const reviewRef = useRef<HTMLElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const preview = useRef<{ files: Record<"docx" | "pdf", Blob>; revision: number } | null>(null);
  const master = useRef<{ files: Record<"docx" | "pdf", Blob>; hash: string } | null>(null);
  const ticket = useRef<string>("");
  const source = useRef(initialSource);
  const afterRender = useRef<(() => void) | null>(null);
  const live = useRef({ values, ingredients });
  useLayoutEffect(() => {
    live.current = { values, ingredients };
    const run = afterRender.current;
    afterRender.current = null;
    run?.();
  });

  const destination = dest === "" ? null : (destinations[Number(dest)] ?? null);
  const say = (feedback: Feedback | null, retryTarget?: Element | null) => {
    setStatus(feedback);
    if (feedback) afterRender.current = () => sequence([statusRef.current, retryTarget]);
  };

  // Assistant availability for the chosen outlet (legacy probe()).
  const probeRef = useRef<AbortController | null>(null);
  const probe = useCallback(async (index: string) => {
    probeRef.current?.abort();
    const controller = new AbortController();
    probeRef.current = controller;
    const chosen = index !== "";
    plating.current?.setOutlet(chosen, null, chosen);
    setProbeFailed(false);
    if (!chosen) return;
    const d = destinations[Number(index)]!;
    try {
      const available = await postJson(`${d.hotelKey}/${d.outletKey}/assistant/status`, {}, controller.signal);
      if (controller.signal.aborted) return;
      plating.current?.setOutlet(true, !!(available.watercolor && available.composition), false, !!available.composition);
    } catch {
      if (controller.signal.aborted) return;
      plating.current?.setOutlet(true, false);
      setProbeFailed(true);
    }
  }, [destinations]);

  useEffect(() => {
    if (initialSource && destination) void restoreMedia(initialSource, destination);
    void probe(dest);
    return () => probeRef.current?.abort();
    // Once on mount: the destination select drives later probes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Legacy loadGuideSource(): fetch the draft's pictures, check their digests, restore the assistant. */
  async function restoreMedia(initial: InitialSource, d: Destination) {
    const assets = (initial.media.assets ?? {}) as Record<string, { sha256: string; name?: string }>;
    const media: Record<string, unknown> = { ...initial.media };
    delete media.assets;
    delete media.approved;
    try {
      for (const slot of ["original", "photo", "art", "image"] as const) {
        const asset = assets[slot];
        if (!asset) continue;
        const path = [d.hotelKey, d.outletKey, initial.guideKey, "source", slot].map(encodeURIComponent).join("/");
        const response = await fetch(`/api/guides/${path}?sha=${asset.sha256}`);
        if (!response.ok) throw new Error("No se ha podido leer la fotografía.");
        const blob = await response.blob();
        if ((await fingerprint(blob)) !== asset.sha256) throw new Error("No se ha podido leer la fotografía.");
        if (slot === "original") media.original = new File([blob], asset.name || "foto", { type: blob.type });
        else {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let binary = "";
          for (let i = 0; i < bytes.length; i += 24576) binary += String.fromCharCode(...bytes.subarray(i, i + 24576));
          media[slot] = btoa(binary);
        }
      }
      const approved = initial.media.approved as { tipo: "foto" | "acuarela" } | null | undefined;
      if (approved) media.kind = approved.tipo;
      plating.current?.restore(media as Partial<Media>, !!initial.data.ingredientes_en_foto);
    } catch (error) {
      say(feedbackFor(error, locale));
    }
  }

  const request = useCallback(
    async (operation: string, payload: Record<string, unknown>, signal?: AbortSignal) => {
      const d = destinations[Number(dest)];
      if (dest === "" || !d) throw new Error("Outlet no disponible para edición");
      return postJson(`${d.hotelKey}/${d.outletKey}/assistant/${operation}`, payload, signal);
    },
    [dest, destinations],
  );
  const readDish = useCallback(() => ({ name: live.current.values.nombre_es!.trim(), ingredients: live.current.ingredients.map(fieldsOf) }), []);

  // ---- Field helpers ----------------------------------------------------------
  const uid = useId();
  const withHelp = (content: ReactNode, key: string) => (
    <div className={cx("recipe-field")}>
      {content}
      <small className={cx("recipe-field-help")} id={`${uid}-help-${key}`}>
        {help(key)}
      </small>
    </div>
  );
  const button = (label: string, onClick: () => void, primary = false, extra: { disabled?: boolean; hidden?: boolean } = {}) => (
    <button type="button" className={primary ? "btn btn-primary download primary" : "btn download"} onClick={onClick} disabled={extra.disabled} hidden={extra.hidden}>
      {label}
    </button>
  );
  const grow = (el: HTMLTextAreaElement | null, animate = false) => {
    if (!el || !el.isConnected || el.offsetWidth === 0) return;
    const previous = el.offsetHeight;
    el.style.height = "auto";
    const border = el.offsetHeight - el.clientHeight;
    const height = el.scrollHeight + border;
    el.style.height = `${height}px`;
    if (animate && previous !== height && el.closest(".step-row")) carbon(el);
  };
  useEffect(() => {
    const resize = () => form.current?.querySelectorAll("textarea").forEach((el) => grow(el));
    resize();
    addEventListener("resize", resize);
    return () => removeEventListener("resize", resize);
  }, [mode]);

  const label = (key: string, required: boolean) => (
    <span>
      {t(key)}
      {required && <span aria-hidden="true"> *</span>}
    </span>
  );
  const control = ([key, title, max, type]: FieldSpec, value: string, onChange: (v: string) => void, required = false, ref?: React.Ref<HTMLInputElement>) =>
    withHelp(
      type === "date" ? (
        <label htmlFor={`${uid}-${key}`}>
          {label(title, required)}
          <DatePicker id={`${uid}-${key}`} value={value} onChange={onChange} describedBy={`${uid}-help-${key}`} />
        </label>
      ) : (
        <label>
          {label(title, required)}
          {type === "textarea" ? (
            <textarea
              name={key}
              maxLength={max}
              dir="auto"
              rows={2}
              wrap="soft"
              required={required}
              value={value}
              aria-describedby={`${uid}-help-${key}`}
              ref={(el) => grow(el)}
              onChange={(e) => {
                onChange(e.target.value);
                grow(e.target, true);
              }}
            />
          ) : (
            <input
              ref={ref}
              name={key}
              type="text"
              maxLength={max}
              dir="auto"
              required={required}
              value={value}
              aria-describedby={`${uid}-help-${key}`}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        </label>
      ),
      key,
    );

  function rows(title: string, specs: FieldSpec[], list: Row[], setList: (rows: Row[]) => void, max: number, steps: boolean) {
    const changed = () => {
      if (!steps) plating.current?.dishChanged(true);
    };
    return (
      <fieldset>
        <legend>{t(title)}</legend>
        <div>
          {list.map((row, index) => (
            <div key={row.id} className={cx("recipe-row", steps && "step-row")} data-row={row.id}>
              {specs.map((spec, i) =>
                <Fragment key={spec[0]}>
                  {control(spec, row[spec[0]] ?? "", (v) => {
                    setList(list.map((r) => (r.id === row.id ? { ...r, [spec[0]]: v } : r)));
                    changed();
                  }, i === 0)}
                </Fragment>,
              )}
              <button
                type="button"
                className="btn download"
                aria-label={t(steps ? "quitarEstePaso" : "quitarEsteIngrediente")}
                disabled={list.length === 1}
                onClick={(e) => {
                  const hadFocus = e.currentTarget.closest(".recipe-row")?.contains(document.activeElement);
                  const neighbor = list[index + 1] ?? list[index - 1];
                  setList(list.filter((r) => r.id !== row.id));
                  changed();
                  afterRender.current = () => {
                    const el = neighbor && form.current?.querySelector(`[data-row="${neighbor.id}"]`);
                    if (hadFocus) (el?.querySelector<HTMLElement>("input,textarea") ?? null)?.focus({ preventScroll: true });
                    if (el) carbon(el);
                  };
                }}
              >
                {t("quitar")}
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-primary download primary"
          disabled={list.length >= max}
          onClick={() => {
            const row = newRow();
            setList([...list, row]);
            changed();
            afterRender.current = () => carbon(form.current?.querySelector(`[data-row="${row.id}"]`));
          }}
        >
          {t(steps ? "anadirPaso" : "anadirIngrediente")}
        </button>
      </fieldset>
    );
  }

  // ---- Review, generation, saving -------------------------------------------------
  async function submit() {
    if (!destination || busy) return;
    setBusy(true);
    say(null);
    try {
      const data: Record<string, unknown> = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()]));
      data.nombre_en = (source.current?.data.nombre_en as string) ?? "";
      data.sala_en = (source.current?.data.sala_en as string) ?? "";
      data.ingredientes = ingredients.map((r) => Object.fromEntries(Object.entries(fieldsOf(r)).map(([k, v]) => [k, v.trim()])));
      data.pasos = steps.map((r) => Object.fromEntries(Object.entries(fieldsOf(r)).map(([k, v]) => [k, v.trim()])));
      const media = (await plating.current?.getMedia()) ?? null;
      data.foto = media ? (media.kind === "acuarela" ? media.image : media.photo) : "";
      data.ingredientes_en_foto = !!(data.foto && media?.checked);
      if (data.foto) {
        data.imagen_aprobada = { tipo: media!.kind, sha256: await fingerprint(b64ToBlob(data.foto as string, "application/octet-stream")) };
      }
      const name = data.nombre_es as string;
      const rowsOk = (data.ingredientes as Record<string, string>[]).every((i) => i.nombre) && (data.pasos as Record<string, string>[]).every((i) => i.accion);
      if (!name || name.includes("/") || !rowsOk) throw new Error("Completa el nombre, cada ingrediente y cada paso. El nombre del plato no puede incluir barras.");
      setReview({ data, media, destination });
      setMode("review");
      afterRender.current = () => {
        reviewRef.current?.querySelector<HTMLElement>("h2")?.focus();
        sequence([...(reviewRef.current?.children ?? [])]);
      };
    } catch (error) {
      say(feedbackFor(error, locale), form.current?.querySelector('button[type="submit"]'));
    } finally {
      setBusy(false);
    }
  }

  async function rendition(masterRendition = false) {
    const d = review!.destination;
    const reply = await postJson(`${d.hotelKey}/${d.outletKey}/documents${masterRendition ? "?rendition=master" : ""}`, review!.data);
    return {
      files: { docx: b64ToBlob(reply.docx as string, MIME.docx), pdf: b64ToBlob(reply.pdf as string, MIME.pdf) },
      revision: reply.brand_revision as number,
    };
  }

  async function generate(button: HTMLElement) {
    setBusy(true);
    say({ key: "generandoLosDocumentos" });
    try {
      preview.current = await rendition();
      master.current = null;
      ticket.current = crypto.randomUUID();
      setSaved(null);
      setStatus(null);
      setMode("generated");
      afterRender.current = () => {
        reviewRef.current?.querySelector<HTMLElement>("h2")?.focus();
        sequence([reviewRef.current?.firstElementChild, ...(reviewRef.current?.querySelector(".toolbar")?.children ?? [])]);
      };
    } catch (error) {
      say(feedbackFor(error, locale), button);
    } finally {
      setBusy(false);
    }
  }

  async function download(format: "docx" | "pdf", button: HTMLButtonElement) {
    button.disabled = true;
    try {
      const d = review!.destination;
      const revision = await brandRevision(d.hotelKey);
      if (revision !== null && preview.current?.revision !== revision) preview.current = await rendition();
      const url = URL.createObjectURL(preview.current!.files[format]);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${review!.data.nombre_es}.${format}`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (error) {
      say(feedbackFor(error, locale), button);
    } finally {
      button.disabled = false;
    }
  }

  async function saveDraft(button: HTMLButtonElement) {
    button.disabled = true;
    say({ key: "guardandoEnGuiasDe" });
    try {
      const d = review!.destination;
      if (!master.current) {
        const files = (await rendition(true)).files;
        master.current = { files, hash: await fingerprint(files.docx) };
      }
      let key = source.current?.guideKey;
      if (!key) {
        const reserved = await reserveDraft(d.hotelKey, d.outletKey, ticket.current, review!.data.nombre_es as string, master.current.hash);
        if (!reserved.ok) throw new GeneratorError(reserved.status, reserved.detail);
        key = reserved.data.key;
      }
      await saveGuideSource(d, key, review!.data, review!.media ?? {}, master.current.files, source.current?.revision ?? null);
      setSaved(`/empresa/${[d.hotel, d.outlet, "Plating Guides", key].map(encodeURIComponent).join("/")}`);
      say({ key: "wordYPdfGuardados" });
    } catch (error) {
      say(feedbackFor(error, locale), button);
      button.disabled = false;
    }
  }

  function another() {
    const keep = dest;
    source.current = undefined;
    setLockedDest(false);
    setValues(Object.fromEntries([...dishFields, ...serviceFields].map(([k]) => [k, ""])));
    setIngredients([newRow()]);
    setSteps([newRow()]);
    plating.current?.reset();
    setDest(keep);
    setReview(null);
    setStatus(null);
    setMode("form");
    void probe(keep);
    afterRender.current = () => nameRef.current?.focus();
  }

  if (!destinations.length) return <p>{t("todaviaNoHayUn")}</p>;

  const summaryFields = [...dishFields.slice(1), ...serviceFields];
  const data = review?.data;
  return (
    <div className={cx("root")}>
      <p className={cx("intro")}>{t("eligeElOutletIntroduce")}</p>
      <form
        ref={form}
        className={cx("recipe-form", helpAll && "recipe-help-all")}
        hidden={mode !== "form"}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <button
          type="button"
          className={cx("recipe-help-toggle")}
          aria-pressed={helpAll}
          onClick={(e) => {
            const enabled = !helpAll;
            setHelpAll(enabled);
            const toggle = e.currentTarget;
            afterRender.current = () => {
              const hints = enabled ? [...(form.current?.querySelectorAll(".recipe-field-help") ?? [])] : [toggle];
              carbon(...hints);
            };
          }}
        >
          <span className={cx("recipe-help-icon")} aria-hidden="true">
            ?
          </span>
          {t("mostrarAyudaDelRecetario")}
        </button>
        <fieldset ref={general}>
          <legend>{t("datosDelPlato")}</legend>
          <div className={cx("recipe-fields")}>
            <div className={cx("recipe-field")}>
              <label>
                {label("hotelYOutlet", true)}
                <SelectField
                  value={dest}
                  disabled={lockedDest}
                  className="mt-[.3rem] min-h-[46px] py-[.6rem] text-base/[1.4] font-normal"
                  options={[{ value: "", label: t("seleccionaUnOutlet") }, ...destinations.map((d, i) => ({ value: String(i), label: `${d.hotel} · ${d.outlet}` }))]}
                  onValueChange={(v) => {
                    setDest(v);
                    plating.current?.changeOutlet();
                    void probe(v);
                  }}
                />
              </label>
              <small className={cx("recipe-field-help")}>{help("recipeDestination")}</small>
              <div className={cx("toolbar")} hidden={!probeFailed}>
                <small className={cx("hint")} role="status">
                  {probeFailed ? t("noSePudoComprobar") : ""}
                </small>
                {button(t("reintentar"), () => void probe(dest))}
              </div>
            </div>
            {dishFields.map((spec) =>
              <Fragment key={spec[0]}>
                {control(spec, values[spec[0]]!, (v) => {
                  setValues((all) => ({ ...all, [spec[0]]: v }));
                  if (spec[0] === "nombre_es") plating.current?.dishChanged(false);
                }, spec[0] === "nombre_es", spec[0] === "nombre_es" ? nameRef : undefined)}
              </Fragment>,
            )}
          </div>
        </fieldset>
        {rows("ingredientes", ingredientSpecs, ingredients, setIngredients, 40, false)}
        {rows("emplatadoPasoAPaso", stepSpecs, steps, setSteps, 24, true)}
        <fieldset>
          <legend>{t("informacionParaSalaY")}</legend>
          <div className={cx("recipe-fields")}>
            {serviceFields.map((spec) => <Fragment key={spec[0]}>{control(spec, values[spec[0]]!, (v) => setValues((all) => ({ ...all, [spec[0]]: v })))}</Fragment>)}
          </div>
        </fieldset>
        <fieldset>
          <legend>{t("fotografiaDeEmplatado")}</legend>
          <PlatingAssistant ref={plating} request={request} readDish={readDish} withHelp={withHelp} button={button} />
        </fieldset>
        <button type="submit" className="btn btn-primary download primary" disabled={busy || !destination}>
          {t("revisarFicha")}
        </button>
      </form>
      <section ref={reviewRef} className={cx("recipe-review")} hidden={mode === "form"}>
        {review && data && mode === "review" && (
          <>
            <h2 tabIndex={-1}>{t("revisarFicha")}</h2>
            <p>
              {review.destination.hotel} · {review.destination.outlet}
            </p>
            <h3>{data.nombre_es as string}</h3>
            <dl className={cx("recipe-summary")}>
              {summaryFields
                .filter(([k]) => data[k])
                .map(([k, title]) => (
                  <Fragment key={k}>
                    <dt>{t(title)}</dt>
                    <dd dir="auto">
                      {k === "fecha" ? (
                        <time dateTime={data[k] as string}>
                          {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${data[k]}T00:00:00Z`))}
                        </time>
                      ) : (
                        (data[k] as string)
                      )}
                    </dd>
                  </Fragment>
                ))}
            </dl>
            {!data.ingredientes_en_foto && (
              <>
                <h3>{t("ingredientes")}</h3>
                <ul>
                  {(data.ingredientes as Record<string, string>[]).map((i, n) => (
                    <li key={n}>{[i.nombre, i.cantidad, i.unidad].filter(Boolean).join(" · ")}</li>
                  ))}
                </ul>
              </>
            )}
            <h3>{t("emplatado")}</h3>
            <ol>
              {(data.pasos as Record<string, string>[]).map((i, n) => (
                <li key={n}>{[i.accion, i.control].filter(Boolean).join(" — ")}</li>
              ))}
            </ol>
            {Boolean(data.foto) && (
              // eslint-disable-next-line @next/next/no-img-element -- local data URL preview
              <img
                className={cx("recipe-photo")}
                alt={t("fotoDeEmplatadoSeleccionada")}
                src={`data:${review.media?.kind === "acuarela" ? "image/png" : "image/jpeg"};base64,${data.foto as string}`}
              />
            )}
            {Boolean(data.ingredientes_en_foto) && <small className={cx("hint")}>{t("laFotoYaIncluye")}</small>}
            <div className={cx("toolbar")}>
              {button(
                t("volverAEditar"),
                () => {
                  setMode("form");
                  setStatus(null);
                  afterRender.current = () => {
                    nameRef.current?.focus();
                    carbon(general.current);
                  };
                },
                false,
                { disabled: busy },
              )}
              <button type="button" className="btn btn-primary download primary" disabled={busy} onClick={(e) => void generate(e.currentTarget)}>
                {t("generarWordYPdf")}
              </button>
            </div>
          </>
        )}
        {review && data && mode === "generated" && (
          <>
            <h2 tabIndex={-1}>{t("fichaGenerada")}</h2>
            <p>
              {data.nombre_es as string} · {review.destination.outlet}
            </p>
            <div className={cx("toolbar")}>
              <button type="button" className="btn download" onClick={(e) => void download("docx", e.currentTarget)}>
                {t("descargarWord")}
              </button>
              <button type="button" className="btn download" onClick={(e) => void download("pdf", e.currentTarget)}>
                {t("descargarPdf")}
              </button>
              {saved ? (
                <Link href={saved} className="btn btn-primary download primary">
                  {t("abrirBorrador")}
                </Link>
              ) : (
                <button type="button" className="btn btn-primary download primary" onClick={(e) => void saveDraft(e.currentTarget)}>
                  {t("guardarComoBorrador")}
                </button>
              )}
            </div>
            {button(t("prepararOtraFicha"), another)}
          </>
        )}
      </section>
      <p ref={statusRef} className="alert-ok feedback" role="status">
        {status ? t(status.key, status.params) : ""}
      </p>
    </div>
  );
}
