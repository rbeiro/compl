"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { loadBrand, saveBrand } from "@/app/actions/generator";
import { ColorPicker, hexColor } from "@/components/pickers/color-picker";
import { SelectField } from "@/components/select-field";
import { tactil } from "@/lib/motion";
import styles from "./generator.module.css";

// Port of brandSettings() in legacy/public/document-brand.js: the hotel's
// document colour and logo with a live header preview. Motion: "brand-color"
// and "brand-logo" = tactil.

const cx = (...names: (string | false | null | undefined)[]) =>
  names.filter(Boolean).map((n) => `${styles[n as string] ?? ""} ${n}`).join(" ");

const MAX_UPLOAD = 5 * 1024 * 1024;
const LOGO_WIDTH = 402;
const LOGO_HEIGHT = 156;
const INVALID = "eligeUnaImagenPng";
const OVERSIZED = "elLogotipoSuperaEl";
const TRANSPARENT = "elLogotipoEsCompletamente";
export const BRAND_EVENT = "compi.documentBrandUpdate";

type Profile = { accent: string; logo_png: string | null; revision: number };
type Notice = { key: string; error?: boolean } | null;

// Check the pixel budget before asking the browser to decode the image.
function imageHeader(bytes: ArrayBuffer) {
  const view = new DataView(bytes);
  if (view.byteLength >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a && view.getUint32(12) === 0x49484452) {
    return { width: view.getUint32(16), height: view.getUint32(20), type: "image/png" };
  }
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) throw new Error(INVALID);
  let p = 2;
  while (p + 4 <= view.byteLength && view.getUint8(p) === 0xff) {
    while (p < view.byteLength && view.getUint8(p) === 0xff) p++;
    if (p + 3 > view.byteLength) break;
    const tag = view.getUint8(p++);
    if (tag === 0xda || tag === 0xd9) break;
    const size = view.getUint16(p);
    if (size < 2 || p + size > view.byteLength) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(tag) && size >= 8) {
      return { height: view.getUint16(p + 3), width: view.getUint16(p + 5), type: "image/jpeg" };
    }
    p += size;
  }
  throw new Error(INVALID);
}

/** Legacy readLogo(): fit the logo into the 402×156 header slot as a PNG. */
async function readLogo(file: File) {
  if (!file.size || file.size > MAX_UPLOAD) throw new Error(INVALID);
  const bytes = await file.arrayBuffer();
  const { width, height, type } = imageHeader(bytes);
  if (!width || !height) throw new Error(INVALID);
  if (width > 8192 || height > 8192 || width * height > 16_000_000) throw new Error(OVERSIZED);
  const image = await createImageBitmap(new Blob([bytes], { type })).catch(() => {
    throw new Error(INVALID);
  });
  try {
    const canvas = document.createElement("canvas");
    canvas.width = LOGO_WIDTH;
    canvas.height = LOGO_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) throw new Error(INVALID);
    const factor = Math.min(LOGO_WIDTH / image.width, LOGO_HEIGHT / image.height);
    const w = image.width * factor, h = image.height * factor;
    context.drawImage(image, (LOGO_WIDTH - w) / 2, (LOGO_HEIGHT - h) / 2, w, h);
    const data = context.getImageData(0, 0, LOGO_WIDTH, LOGO_HEIGHT).data;
    let visible = false;
    for (let i = 3; i < data.length; i += 4) if (data[i]) { visible = true; break; }
    if (!visible) throw new Error(TRANSPARENT);
    return canvas.toDataURL("image/png").split(",")[1]!;
  } finally {
    image.close();
  }
}

export function BrandSettings({ hotels, selected }: { hotels: { key: string; name: string }[]; selected?: string }) {
  const t = useTranslations("Generator");
  const [hotel, setHotel] = useState(selected ?? hotels[0]!.key);
  const [original, setOriginal] = useState<Profile | null>(null);
  const [hex, setHex] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [failed, setFailed] = useState(false);
  const drafts = useRef(new Map<string, { hex: string; logo: string | null; revision: number }>());
  const turn = useRef(0);
  const canvas = useRef<HTMLDivElement>(null);
  const logoImg = useRef<HTMLImageElement>(null);
  const afterRender = useRef<(() => void) | null>(null);
  const [uploadKey, setUploadKey] = useState(0);
  useLayoutEffect(() => {
    const run = afterRender.current;
    afterRender.current = null;
    run?.();
  });

  const accent = hexColor(hex);
  const dirty = !!original && (accent?.slice(1) !== original.accent || logo !== original.logo_png);
  const busy = loading || saving || importing;

  const loadHotel = useCallback(async (key: string, restoreDraft = true) => {
    const n = ++turn.current;
    setOriginal(null);
    setLogo(null);
    setHex("");
    setLoading(true);
    setConflict(false);
    setFailed(false);
    setNotice({ key: "cargando" });
    const result = await loadBrand(key);
    if (n !== turn.current) return;
    setLoading(false);
    if (!result.ok) {
      setFailed(true);
      setNotice({ key: result.status === 403 ? "tuCuentaNoPuede" : "noSePudoCargar", error: true });
      return;
    }
    const server = { accent: result.data.accent.replace(/^#/, "").toUpperCase(), logo_png: result.data.logo_png, revision: result.data.revision };
    const saved = restoreDraft ? drafts.current.get(key) : undefined;
    setOriginal(saved && saved.revision !== server.revision ? { ...server, revision: saved.revision } : server);
    setHex(saved ? saved.hex : `#${server.accent}`);
    setLogo(saved ? saved.logo : server.logo_png);
    if (saved && saved.revision !== server.revision) {
      setConflict(true);
      setFailed(true);
      setNotice({ key: "otraPersonaHaActualizado", error: true });
    } else setNotice(null);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first load, as legacy loadHotel()
    void loadHotel(hotel);
    // Only on mount; changing hotels loads explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animateColor = () => (afterRender.current = () => tactil(canvas.current));
  const animateLogo = () => (afterRender.current = () => tactil(logoImg.current));

  const save = async () => {
    if (!original || !accent || !dirty || conflict || busy) return;
    const h = hotel;
    setSaving(true);
    setNotice({ key: "guardandoLaMarca" });
    const result = await saveBrand(h, accent.slice(1), logo, original.revision);
    setSaving(false);
    if (result.ok) {
      const savedProfile = { accent: result.data.accent.replace(/^#/, "").toUpperCase(), logo_png: result.data.logo_png, revision: result.data.revision };
      setOriginal(savedProfile);
      setLogo(savedProfile.logo_png);
      setHex(`#${savedProfile.accent}`);
      drafts.current.delete(h);
      window.dispatchEvent(new Event(BRAND_EVENT));
      try {
        localStorage.setItem(BRAND_EVENT, crypto.randomUUID());
      } catch {
        // Optional cross-tab notification.
      }
      setNotice({ key: "marcaGuardadaLasFichas" });
    } else if (result.status === 409) {
      setConflict(true);
      setFailed(true);
      setNotice({ key: "otraPersonaHaActualizado", error: true });
    } else if (result.status === 422) setNotice({ key: "elServidorNoHa", error: true });
    else setNotice({ key: result.status === 403 ? "tuCuentaNoPuede" : "noSePudoGuardar", error: true });
  };

  const name = hotels.find((h) => h.key === hotel)?.name ?? hotel;
  return (
    <div className={cx("root", "document-brand")}>
      <p className={cx("intro")}>{t("elLogotipoYEl")}</p>
      <label>
        {t("hotel")}
        <SelectField
          value={hotel}
          disabled={saving || importing}
          className="mt-[.3rem] min-h-[46px] py-[.6rem] text-base/[1.4] font-normal"
          options={hotels.map((h) => ({ value: h.key, label: h.name }))}
          onValueChange={(next) => {
            if (original) {
              if (dirty) drafts.current.set(hotel, { hex, logo, revision: original.revision });
              else drafts.current.delete(hotel);
            }
            setHotel(next);
            void loadHotel(next);
          }}
        />
      </label>
      <p className={cx("feedback", notice?.error && "error") + " alert-ok"} role="status">
        {notice ? t(notice.key) : ""}
      </p>
      <button
        type="button"
        className="btn download"
        hidden={!failed}
        onClick={() => {
          drafts.current.delete(hotel);
          void loadHotel(hotel, false);
        }}
      >
        {t("volverACargar")}
      </button>
      <div className={cx("brand-editor")} hidden={!original}>
        <form
          className={cx("brand-form")}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={busy}>
            <legend>{t("identidadDelHotel")}</legend>
            <div className={cx("brand-colors")}>
              <label>
                {t("colorDeLasFichas")}
                <ColorPicker
                  value={accent ?? "#23603F"}
                  onChange={(value) => {
                    setHex(value);
                    if (!conflict) setNotice(null);
                    animateColor();
                  }}
                />
              </label>
              <label>
                {t("codigoDeColor")}
                <input
                  type="text"
                  dir="ltr"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={7}
                  value={hex}
                  aria-invalid={!accent}
                  onChange={(e) => {
                    setHex(e.target.value);
                    if (!conflict) setNotice(hexColor(e.target.value) ? null : { key: "introduceUnCodigoDe", error: true });
                    animateColor();
                  }}
                  onBlur={() => {
                    if (accent) setHex(accent);
                  }}
                />
              </label>
            </div>
            <label htmlFor="document-brand-logo">{t("logotipoDelHotel")}</label>
            <div className={cx("brand-actions")}>
              <span className={cx("localized-file")}>
                <span className="btn download">{t("elegirLogotipo")}</span>
                <input
                  key={uploadKey}
                  id="document-brand-logo"
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={async (e) => {
                    const file = e.currentTarget.files?.[0];
                    if (!file || !original) return;
                    setImporting(true);
                    try {
                      setLogo(await readLogo(file));
                      if (!conflict) setNotice(null);
                      animateLogo();
                    } catch (error) {
                      const key = (error as Error).message;
                      setNotice({ key: [INVALID, OVERSIZED, TRANSPARENT].includes(key) ? key : INVALID, error: true });
                    } finally {
                      setImporting(false);
                      setUploadKey((k) => k + 1);
                    }
                  }}
                />
              </span>
              <button
                type="button"
                className="btn download"
                disabled={!logo}
                onClick={() => {
                  setLogo(null);
                  if (!conflict) setNotice(null);
                }}
              >
                {t("quitarLogotipo")}
              </button>
            </div>
            <small className={cx("hint")}>{t("pngOJpgDe")}</small>
          </fieldset>
          <div className={cx("brand-actions")}>
            <button type="submit" className="btn btn-primary download primary" disabled={busy || !dirty || !accent || conflict}>
              {t("guardarMarcaDelHotel")}
            </button>
            <button
              type="button"
              className="btn download"
              disabled={busy || !dirty || conflict}
              onClick={() => {
                if (!original) return;
                setHex(`#${original.accent}`);
                setLogo(original.logo_png);
                drafts.current.delete(hotel);
                setNotice(null);
                animateColor();
              }}
            >
              {t("descartarCambios")}
            </button>
          </div>
        </form>
        <figure className={cx("brand-preview")}>
          <figcaption>{t("vistaPreviaDeLa")}</figcaption>
          <div ref={canvas} className={cx("brand-header-preview")} dir="ltr" style={{ borderBottomColor: accent ?? undefined }}>
            <div className={cx("brand-logo-slot")}>
              {/* eslint-disable-next-line @next/next/no-img-element -- data URL preview */}
              <img ref={logoImg} alt="" hidden={!logo} src={logo ? `data:image/png;base64,${logo}` : undefined} />
            </div>
            <bdi>{name}</bdi>
          </div>
        </figure>
      </div>
    </div>
  );
}
