import { createHash, randomUUID } from "node:crypto";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateGuideFile } from "../src/documents/legacy/validate.js";
import { setupApp } from "./fixtures.js";

const { app, pool, createUser, addStaff, tokenFor, close } = await setupApp();
const H = "hotel-generador", O = "enoteca";
let chef: string, editor: string, staff: string;

const call = (token: string, method: string, path: string, body?: unknown, type = "application/json") =>
  app.request(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": type } : {}) },
    body: body === undefined ? undefined : body instanceof Uint8Array ? (body as unknown as ArrayBuffer) : JSON.stringify(body),
  });
const recipe = {
  nombre_es: "Gazpacho",
  partida: "Fríos",
  pase: "3 min",
  ingredientes: [{ nombre: "Tomate", cantidad: "200", unidad: "g" }],
  pasos: [{ accion: "Servir en plato hondo", control: "Muy frío" }],
};
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
function png() {
  const image = new PNG({ width: 4, height: 4 });
  image.data.fill(200);
  return new Uint8Array(PNG.sync.write(image));
}

beforeAll(async () => {
  const [c, e, s] = await Promise.all([createUser("gen.chef@compichef.com"), createUser("gen.editor@compichef.com"), createUser("gen.staff@compichef.com")]);
  await addStaff(c!, H, 1);
  await addStaff(e!, H, 2);
  await addStaff(s!, H, 3);
  chef = await tokenFor(c!, { aal: "aal2" });
  editor = await tokenFor(e!);
  staff = await tokenFor(s!);
  await pool.query(`insert into public.compi_arts_outlets (hotel_key, outlet_key, hotel, outlet) values ($1, $2, 'Hotel Generador', 'Enoteca')`, [H, O]);
});
afterAll(close);

describe("recipe generator", () => {
  it("renders valid Word and PDF files for editors", async () => {
    expect((await call(staff, "POST", `/v1/outlets/${H}/${O}/documents`, recipe)).status).toBe(403);
    const bad = await call(editor, "POST", `/v1/outlets/${H}/${O}/documents`, { ...recipe, nombre_es: "a/b" });
    expect(bad.status).toBe(422);
    const res = await call(editor, "POST", `/v1/outlets/${H}/${O}/documents`, recipe);
    expect(res.status).toBe(200);
    const files = (await res.json()) as { docx: string; pdf: string; brand_revision: number };
    await validateGuideFile("docx", new Uint8Array(Buffer.from(files.docx, "base64")));
    await validateGuideFile("pdf", new Uint8Array(Buffer.from(files.pdf, "base64")));
    expect(typeof files.brand_revision).toBe("number");
  });

  it("saves a generated recipe as a draft with its source, then reopens it", async () => {
    const master = (await (await call(editor, "POST", `/v1/outlets/${H}/${O}/documents?rendition=master`, recipe)).json()) as { docx: string; pdf: string };
    const docx = new Uint8Array(Buffer.from(master.docx, "base64"));
    const pdf = new Uint8Array(Buffer.from(master.pdf, "base64"));
    const ticket = randomUUID();
    const reserve = () => call(editor, "POST", `/v1/outlets/${H}/${O}/drafts`, { ticket, label: "Gazpacho", fingerprint: sha(docx) });
    const { key } = (await (await reserve()).json()) as { key: string };
    expect(((await (await reserve()).json()) as { key: string }).key).toBe(key); // idempotent
    const base = `/v1/guides/${H}/${O}/${key}`;

    const image = png();
    const art = await call(editor, "PUT", `${base}/source/image`, image, "application/octet-stream");
    expect(art.status).toBe(200);
    const asset = (await art.json()) as { sha256: string; ruta: string };
    expect(asset.sha256).toBe(sha(image));
    // The source keeps the cook's photo too (JPEG); the approved picture is the watercolour.
    const jpeg = new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70]);
    const photo = (await (await call(editor, "PUT", `${base}/source/photo`, jpeg, "application/octet-stream")).json()) as { sha256: string; ruta: string };
    const staged = await Promise.all(
      (["docx", "pdf"] as const).map(async (fmt) => ((await (await call(editor, "POST", `${base}/stage/${fmt}`, fmt === "docx" ? docx : pdf, "application/octet-stream")).json()) as { sha256: string }).sha256),
    );
    const source = {
      data: { ...recipe, ingredientes_en_foto: false },
      media: { kind: "acuarela" },
      assets: { image: asset, photo },
      imagen_aprobada: { tipo: "acuarela", ruta: asset.ruta, sha256: asset.sha256 },
    };
    const saved = await call(editor, "PUT", `${base}/source`, { source, docx: staged[0], pdf: staged[1], previous: null });
    expect(saved.status).toBe(200);
    const { revision } = (await saved.json()) as { revision: string };

    const snapshot = (await (await call(editor, "GET", `${base}/source`)).json()) as any;
    expect(snapshot.revision).toBe(revision);
    expect(snapshot.source.data.nombre_es).toBe("Gazpacho");
    const read = await call(editor, "GET", `${base}/source/image?sha=${asset.sha256}`);
    expect(read.status).toBe(200);
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(image);
    // Saving the same source again is harmless; a change on a stale revision is refused.
    expect((await call(editor, "PUT", `${base}/source`, { source, docx: staged[0], pdf: staged[1], previous: null })).status).toBe(200);
    const changed = { ...source, data: { ...source.data, pase: "4 min" } };
    expect((await call(editor, "PUT", `${base}/source`, { source: changed, docx: staged[0], pdf: staged[1], previous: null })).status).toBe(409);
    // Both files are in place: the draft can be published.
    expect((await call(editor, "POST", `${base}/publish`)).status).toBe(204);
  });
});

describe("recipe assistant", () => {
  it("reports what is available and refuses without a provider", async () => {
    const status = await call(editor, "POST", `/v1/outlets/${H}/${O}/assistant/status`, {});
    expect(await status.json()).toEqual({ translation: false, composition: false, watercolor: false });
    expect((await call(staff, "POST", `/v1/outlets/${H}/${O}/assistant/status`, {})).status).toBe(403);
    const watercolor = await call(editor, "POST", `/v1/outlets/${H}/${O}/assistant/watercolor`, { name: "Gazpacho", ingredients: [], photo: "" });
    expect(watercolor.status).toBeGreaterThanOrEqual(400);
    expect(((await watercolor.json()) as { error: string }).error).toBeTruthy();
  });
});

describe("document brand", () => {
  it("is changed by the executive chef with the expected revision", async () => {
    const brand = (await (await call(editor, "GET", `/v1/hotels/${H}/brand`)).json()) as { revision: number; accent: string };
    expect((await call(editor, "PUT", `/v1/hotels/${H}/brand`, { accent: "112233", logo_png: null, expected_revision: brand.revision })).status).toBe(403);
    const res = await call(chef, "PUT", `/v1/hotels/${H}/brand`, { accent: "aa5500", logo_png: null, expected_revision: brand.revision });
    expect(res.status).toBe(200);
    const saved = (await res.json()) as { accent: string; revision: number; configured: boolean };
    expect(saved).toMatchObject({ accent: "AA5500", revision: brand.revision + 1, configured: true });
    expect((await call(chef, "PUT", `/v1/hotels/${H}/brand`, { accent: "005588", logo_png: null, expected_revision: brand.revision })).status).toBe(409);
    expect((await call(chef, "PUT", `/v1/hotels/${H}/brand`, { accent: "aa5500", logo_png: "bm90LWEtcG5n", expected_revision: saved.revision })).status).toBe(422);
  });
});
