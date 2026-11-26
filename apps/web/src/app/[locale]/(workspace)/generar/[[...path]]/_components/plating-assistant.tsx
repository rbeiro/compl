"use client";

import { useTranslations } from "next-intl";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { tactil } from "@/lib/motion";
import styles from "./generator.module.css";

// Port of legacy/public/plating-assistant.js: the plating photo, the optional
// watercolour with labelled arrows (recipe assistant), label corrections, and
// the choice between photo and watercolour. Motion: "photo-preview" and
// "guide-caption-edit" = tactil.

const cx = (...names: (string | false | null | undefined)[]) =>
  names.filter(Boolean).map((n) => `${styles[n as string] ?? ""} ${n}`).join(" ");

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const BAD_FILE = "eligeUnaFotoJpg";
const BAD_HEIC = "exportaLaFotoHeic";
const heic = (file: File) => /image\/hei[cf](?:-sequence)?$/i.test(file.type) || /\.hei[cf]$/i.test(file.name);

type PlanItem = { text: string; xy: [number, number]; arrow: [number, number][] };
type Art = { art?: string; image?: string; plan?: PlanItem[]; qa?: unknown; master_sha256?: string; prompt_sha256?: string; snapshot?: string };
export type Media = Art & { original: File; photo: string; kind: "foto" | "acuarela"; checked: boolean };
export type Dish = { name: string; ingredients: { nombre?: string; cantidad?: string; unidad?: string }[] };
export type AssistantRequest = (operation: string, payload: Record<string, unknown>, signal?: AbortSignal) => Promise<Record<string, unknown>>;
export type PlatingHandle = {
  setOutlet: (selected: boolean, available: boolean | null, loading?: boolean, prepare?: boolean) => void;
  changeOutlet: () => void;
  reset: () => void;
  dishChanged: (ingredientsChanged: boolean) => void;
  restore: (media: Partial<Media> | undefined, checked: boolean) => void;
  getMedia: () => Promise<Media | null>;
};

function fileData(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]!);
    reader.onerror = () => reject(new Error("noSeHaPodido"));
    reader.readAsDataURL(file);
  });
}

async function decodePhoto(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Some mobile browsers only decode their native formats on an <img>.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Legacy preparePhoto(): a JPEG of at most 1250 px on its longest side. */
async function preparePhoto(file: File) {
  if (file.size > MAX_PHOTO_BYTES || !file.size) throw new Error(BAD_FILE);
  const native = ["image/jpeg", "image/png", "image/webp"].includes(file.type) || (!file.type && /\.(?:jpe?g|png|webp)$/i.test(file.name));
  if (!native && !heic(file)) throw new Error(BAD_FILE);
  const image = await decodePhoto(file).catch(() => {
    throw new Error(heic(file) ? BAD_HEIC : "noSeHaPodido");
  });
  try {
    const width = (image as HTMLImageElement).naturalWidth || image.width;
    const height = (image as HTMLImageElement).naturalHeight || image.height;
    const ratio = Math.min(1, 1250 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.83).split(",")[1]!;
  } finally {
    (image as ImageBitmap).close?.();
  }
}

function newArrow(arrow: [number, number][], target: [number, number]): [number, number][] {
  const [start, first, second, end] = arrow as [[number, number], [number, number], [number, number], [number, number]];
  const penultimate = second.map((v, i) => Math.max(0, Math.min(1, v + ((target[i]! - end[i]!) * 2) / 3))) as [number, number];
  return [start, first, penultimate, target];
}

export const PlatingAssistant = forwardRef<
  PlatingHandle,
  {
    request: AssistantRequest;
    readDish: () => Dish;
    withHelp: (content: ReactNode, key: string) => ReactNode;
    button: (label: string, onClick: () => void, primary?: boolean, extra?: { disabled?: boolean; hidden?: boolean }) => ReactNode;
  }
>(function PlatingAssistant({ request, readDish, withHelp, button }, ref) {
  const t = useTranslations("Generator");
  const [source, setSource] = useState<{ original: File; photo: string } | null>(null);
  const [kind, setKind] = useState<"foto" | "acuarela">("foto");
  const [result, setResult] = useState<Art | null>(null);
  const [status, setStatus] = useState<string>("");
  const [retry, setRetry] = useState<(() => void) | null>(null);
  const [checked, setChecked] = useState(false);
  const [reminder, setReminder] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [availability, setAvailability] = useState<boolean | null>(null);
  const [outlet, setOutletState] = useState({ has: false, checking: false, prepare: false });
  const [editing, setEditing] = useState(-1);
  const [editText, setEditText] = useState("");
  const [target, setTarget] = useState<[string, string]>(["", ""]);
  const work = useRef<Art | null>(null);
  const operation = useRef<AbortController | null>(null);
  const pendingPhoto = useRef<Promise<void> | null>(null);
  const photoVersion = useRef(0);
  const gallery = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const originalImg = useRef<HTMLImageElement>(null);
  const drawingImg = useRef<HTMLImageElement>(null);
  const editFields = useRef<HTMLDivElement>(null);
  const selectLabel = useRef<HTMLLabelElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const live = useRef({ source, result, kind, checked, availability, outlet });
  useEffect(() => {
    live.current = { source, result, kind, checked, availability, outlet };
  });
  const [canSnap, setCanSnap] = useState(false);
  useEffect(() => {
    setCanSnap(window.isSecureContext && "capture" in document.createElement("input") && (navigator.maxTouchPoints > 0 || matchMedia("(pointer: coarse)").matches));
  }, []);

  const message = (key: string, onRetry: (() => void) | null = null) => {
    setStatus(key);
    setRetry(() => onRetry);
  };
  const idleMessage = useCallback((o = live.current.outlet, available = live.current.availability) => {
    if (!o.has) message("seleccionaUnOutletPara");
    else if (o.checking) message("comprobandoDisponibilidad");
    else if (!available) message("laAcuarelaNoEsta");
    else message("");
  }, []);
  const stopOperation = () => {
    operation.current?.abort();
    operation.current = null;
    setBusy(false);
  };
  const isActive = (controller: AbortController) => operation.current === controller && !controller.signal.aborted;
  const invalidateCheck = (hasSource = !!live.current.source) => {
    setChecked(false);
    setReminder(hasSource);
  };
  const closeEditor = () => setEditing(-1);

  async function selectFile(file: File) {
    const version = ++photoVersion.current;
    stopOperation();
    closeEditor();
    message("preparandoLaFoto");
    setPending(true);
    const job = (async () => {
      try {
        const photo = await preparePhoto(file).catch(async (error: Error) => {
          if (error.message !== BAD_HEIC || !live.current.outlet.prepare) throw error;
          try {
            return String((await request("prepare", { photo: await fileData(file) })).photo);
          } catch {
            throw new Error(BAD_HEIC);
          }
        });
        if (version !== photoVersion.current) return;
        const replaced = !!live.current.source;
        setSource({ original: file, photo });
        if (replaced) invalidateCheck(true);
        setKind("foto");
        setResult(null);
        work.current = null;
        idleMessage();
      } catch (error) {
        if (version === photoVersion.current) {
          const key = (error as Error).message;
          message([BAD_FILE, BAD_HEIC].includes(key) ? key : "noSeHaPodido");
        }
      }
    })();
    pendingPhoto.current = job;
    await job;
    if (version === photoVersion.current) {
      pendingPhoto.current = null;
      setPending(false);
      requestAnimationFrame(async () => {
        await originalImg.current?.decode().catch(() => {});
        if (version === photoVersion.current) tactil(originalImg.current);
      });
    }
  }

  const finish = (next: Art) => {
    if (live.current.kind === "acuarela" && live.current.result?.image !== next.image) invalidateCheck();
    setResult(next);
    closeEditor();
  };

  async function generate(fresh: boolean) {
    const current = live.current;
    if (operation.current || !current.source || !current.availability || pendingPhoto.current) return;
    const dish = readDish();
    if (!dish.name || !dish.ingredients.length || dish.ingredients.some((row) => !row.nombre)) {
      message("indicaElNombreDel");
      return;
    }
    closeEditor();
    const snapshot = JSON.stringify(dish);
    if (fresh || work.current?.snapshot !== snapshot) work.current = { snapshot };
    const job = work.current!;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    try {
      if (!job.art) {
        message("generandoLaAcuarela");
        const photo = await fileData(current.source.original);
        if (!isActive(controller)) return;
        Object.assign(job, await request("watercolor", { photo, ...dish }, controller.signal));
        if (!isActive(controller)) return;
      }
      if (!job.plan) {
        message("situandoLosRotulos");
        const response = await request("annotations", { art: job.art, ...dish }, controller.signal);
        if (!isActive(controller)) return;
        job.plan = response.plan as PlanItem[];
        if (response.image && response.qa) {
          job.image = String(response.image);
          job.qa = response.qa;
        }
      }
      message("componiendoLasFlechas");
      const composed = job.image ? job : ((await request("compose", { art: job.art, plan: job.plan }, controller.signal)) as Art);
      if (!isActive(controller)) return;
      finish({ ...job, ...composed, plan: composed.plan ?? job.plan });
      work.current = null;
      message("seHaActualizadoLa");
    } catch (error) {
      if (!isActive(controller)) return;
      if ((error as { status?: number }).status === 422 && job.plan) delete job.plan;
      message("noSePudoCompletar2", () => void generate(false));
    } finally {
      if (isActive(controller)) {
        operation.current = null;
        setBusy(false);
      }
    }
  }

  async function correct() {
    const current = live.current;
    if (operation.current || editing < 0 || !current.availability || !current.result?.plan) return;
    const typed = editText.trim();
    const values = target.map((v) => Number(v));
    if (!typed || target.some((v) => v === "") || values.some((v) => !(v >= 0 && v <= 100))) {
      textRef.current?.focus();
      return;
    }
    const index = editing;
    const entry = current.result.plan[index]!;
    const plan = current.result.plan.map((item, i) =>
      i === index ? { ...entry, text: typed, arrow: newArrow(entry.arrow, [values[0]! / 100, values[1]! / 100]) } : item,
    );
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    message("componiendoLasFlechas");
    try {
      const revised = (await request("compose", { art: current.result.art, plan }, controller.signal)) as Art;
      if (!isActive(controller)) return;
      finish({ ...current.result, ...revised, plan: revised.plan ?? plan });
      message("laImagenFueCorregida");
      requestAnimationFrame(() => tactil(drawingImg.current));
    } catch {
      if (isActive(controller)) message("noSePudoCompletar2", () => void correct());
    } finally {
      if (isActive(controller)) {
        operation.current = null;
        setBusy(false);
      }
    }
  }

  const chooseLabel = (index: number) => {
    const item = live.current.result?.plan?.[index];
    if (operation.current || !item) return;
    setEditing(index);
    setEditText(item.text);
    setTarget(item.arrow[3]!.map((v) => String(Number((v * 100).toFixed(4)))) as [string, string]);
    requestAnimationFrame(() => {
      textRef.current?.focus();
      tactil(editFields.current);
    });
  };

  useImperativeHandle(ref, () => ({
    setOutlet(selected, available, loading = false, prepare = false) {
      const next = { has: selected, checking: loading, prepare };
      setOutletState(next);
      setAvailability(available);
      live.current = { ...live.current, outlet: next, availability: available };
      stopOperation();
      closeEditor();
      idleMessage(next, available);
    },
    changeOutlet() {
      ++photoVersion.current;
      pendingPhoto.current = null;
      setPending(false);
      stopOperation();
      work.current = null;
      setResult(null);
      if (live.current.kind === "acuarela") invalidateCheck();
      setKind("foto");
      closeEditor();
    },
    reset() {
      ++photoVersion.current;
      pendingPhoto.current = null;
      setPending(false);
      stopOperation();
      setSource(null);
      setResult(null);
      work.current = null;
      setKind("foto");
      setChecked(false);
      setReminder(false);
      closeEditor();
      idleMessage();
    },
    dishChanged(ingredientsChanged) {
      if (ingredientsChanged && live.current.source) invalidateCheck();
      if (operation.current || work.current) {
        stopOperation();
        work.current = null;
        closeEditor();
        idleMessage();
      }
    },
    restore(media, wasChecked) {
      if (!media?.photo || !media.original) return;
      setSource({ original: media.original, photo: media.photo });
      const restored = media.art && media.image ? (media as Art) : null;
      setResult(restored);
      if (!restored && media.art) {
        work.current = {
          art: media.art,
          plan: media.plan,
          master_sha256: media.master_sha256,
          prompt_sha256: media.prompt_sha256,
          snapshot: media.snapshot ?? JSON.stringify(readDish()),
        };
      }
      setKind(restored && media.kind === "acuarela" ? "acuarela" : "foto");
      setChecked(!!wasChecked);
    },
    async getMedia() {
      if (pendingPhoto.current) await pendingPhoto.current;
      const current = live.current;
      if (!current.source) return null;
      const media: Media = { original: current.source.original, photo: current.source.photo, kind: current.kind, checked: current.checked };
      const saved = current.result ?? work.current;
      if (saved?.art) {
        for (const k of ["art", "image", "plan", "qa", "master_sha256", "prompt_sha256", "snapshot"] as const) {
          if (saved[k] !== undefined) (media as Record<string, unknown>)[k] = saved[k];
        }
      }
      return media;
    },
  }));

  const plan = result?.plan ?? [];
  const photoURL = source ? `data:image/jpeg;base64,${source.photo}` : undefined;
  const artURL = result?.image ? `data:image/png;base64,${result.image}` : undefined;
  const runDisabled = busy || pending || !source || !availability;
  const card = (title: string, choice: "foto" | "acuarela", img: ReactNode, extra?: ReactNode, hidden = false) => (
    <figure hidden={hidden}>
      <figcaption>{title}</figcaption>
      <div className={cx("plating-viewer", choice === "acuarela" && editing >= 0 && "is-targeting")} onClick={choice === "acuarela" ? onTarget : undefined}>
        {img}
        {extra}
      </div>
      <label className={cx("recipe-photo-label")}>
        <input
          type="radio"
          name="imagen_aprobada"
          value={choice}
          checked={kind === choice}
          onChange={(e) => {
            if (!e.currentTarget.checked || kind === choice) return;
            setKind(choice);
            invalidateCheck();
          }}
        />
        <span>{t(choice === "foto" ? "usarFoto" : "usarAcuarela")}</span>
      </label>
    </figure>
  );
  function onTarget(event: React.MouseEvent<HTMLDivElement>) {
    if (editing < 0 || operation.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratios = [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
    setTarget(ratios.map((r) => String(Number((Math.max(0, Math.min(1, r)) * 100).toFixed(4)))) as [string, string]);
  }
  const measure = (text: string) => {
    if (typeof document === "undefined") return { w: 0, h: 0 };
    const lines = text.split("\n");
    const context = document.createElement("canvas").getContext("2d")!;
    context.font = '44px "Liberation Serif", "Times New Roman", serif';
    return { w: (Math.max(...lines.map((line) => context.measureText(line).width)) / 1600) * 100, h: ((lines.length * 51) / 1200) * 100 };
  };

  return (
    <>
      <p>{t("fotoDelPlatoOpcional")}</p>
      {(["gallery", "camera"] as const).map((which) => (
        <input
          key={which}
          ref={which === "gallery" ? gallery : camera}
          type="file"
          hidden
          accept={which === "gallery" ? "image/jpeg,image/png,image/webp,.heic,.heif" : "image/*"}
          capture={which === "camera" ? "environment" : undefined}
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (file) void selectFile(file);
          }}
        />
      ))}
      {withHelp(
        <div className={cx("toolbar")}>
          {button(t("elegirFoto"), () => gallery.current?.click())}
          {button(t("tomarFoto"), () => camera.current?.click(), false, { hidden: !canSnap })}
          <bdi hidden={!!source}>{t("ningunaFotoSeleccionada")}</bdi>
          <bdi hidden={!source}>{source?.original.name ?? ""}</bdi>
        </div>,
        "foto",
      )}
      <small>{t("jpgPngOWebp")}</small>
      <div className={cx("toolbar", "plating-actions")}>
        {button(t(result ? "regenerarAcuarela" : "generarAcuarelaConFlechas"), () => void generate(!work.current || !!result), false, { disabled: runDisabled })}
        {button(t("reintentar"), () => retry?.(), false, { hidden: !retry })}
      </div>
      <p className={cx("hint")} role="status">
        {status ? t(status) : ""}
      </p>
      <div className={cx("plating-compare")} hidden={!source}>
        {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview */}
        {card(t("fotoDelPlato"), "foto", photoURL ? <img ref={originalImg} src={photoURL} alt={t("fotoDelPlato")} /> : <img ref={originalImg} alt={t("fotoDelPlato")} />)}
        {card(
          t("acuarelaConFlechas"),
          "acuarela",
          // eslint-disable-next-line @next/next/no-img-element -- local data URL preview
          artURL ? <img ref={drawingImg} src={artURL} alt={t("acuarelaConFlechas")} /> : <img ref={drawingImg} alt={t("acuarelaConFlechas")} />,
          <div className={cx("plating-hotspots")} hidden={editing >= 0}>
            {plan.map((item, index) => {
              const size = measure(item.text);
              return (
                <button
                  key={index}
                  type="button"
                  className={cx("plating-hotspot")}
                  aria-label={item.text.replace(/\s+/g, " ")}
                  lang="es"
                  style={{ left: `${item.xy[0] * 100}%`, top: `${item.xy[1] * 100}%`, width: `${size.w}%`, height: `${size.h}%` }}
                  onClick={(e) => {
                    e.stopPropagation();
                    chooseLabel(index);
                  }}
                />
              );
            })}
          </div>,
          !result?.image,
        )}
      </div>
      <div className={cx("plating-editor")} hidden={!result?.image}>
        <label ref={selectLabel}>
          {t("tocaUnRotuloPara")}
          <select
            value={editing >= 0 ? String(editing) : ""}
            disabled={busy || !availability}
            onChange={(e) => (e.target.value === "" ? closeEditor() : chooseLabel(Number(e.target.value)))}
          >
            <option value="">{t("tocaUnRotuloPara")}</option>
            {plan.map((item, i) => (
              <option key={i} value={i}>
                {item.text.replace(/\s+/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <div ref={editFields} className={cx("plating-edit-fields")} hidden={editing < 0}>
          <label>
            {t("textoDelRotulo")}
            <textarea ref={textRef} rows={3} maxLength={180} lang="es" value={editText} onChange={(e) => setEditText(e.target.value)} />
          </label>
          <small>{t("tocaLaImagenPara")}</small>
          <div className={cx("plating-coords")}>
            {(["destinoHorizontal", "destinoVertical"] as const).map((label, i) => (
              <label key={label}>
                {t(label)}
                <input
                  type="number"
                  form="plating-coordinate-editor"
                  min={0}
                  max={100}
                  step="any"
                  disabled={editing < 0}
                  value={target[i]}
                  onChange={(e) => setTarget((v) => (i === 0 ? [e.target.value, v[1]] : [v[0], e.target.value]))}
                />
              </label>
            ))}
          </div>
          <div className={cx("toolbar")}>
            {button(t("aplicarCorreccion"), () => void correct(), true, { disabled: busy })}
            {button(
              t("cancelar"),
              () => {
                closeEditor();
                requestAnimationFrame(() => tactil(selectLabel.current));
              },
              false,
              { disabled: busy },
            )}
          </div>
        </div>
      </div>
      {withHelp(
        <label className={cx("recipe-photo-label")}>
          <input
            type="checkbox"
            name="ingredientes_en_foto"
            checked={checked}
            disabled={!source}
            onChange={(e) => {
              setChecked(e.currentTarget.checked);
              setReminder(false);
            }}
          />
          <span>{t("laFotoYaIncluye")}</span>
        </label>,
        "ingredientes_en_foto",
      )}
      <small className={cx("hint")} role="status" hidden={!reminder}>
        {t("revisaSiLaImagen")}
      </small>
    </>
  );
});
