import { createHash, randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, json, setupApp } from "./fixtures.js";

const { app, pool, store, createUser, addStaff, tokenFor, close } = await setupApp();
const H = "hotel-guias", O = "enoteca", G = "arroz";
const prefix = `${H}/${O}/plating-guides/${G}/`;
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const png = (seed: number) =>
  // Minimal valid PNG header + distinct trailing byte so each image has its own digest.
  new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, seed]);

let staff: string, chef: string, outsider: string;
let pdf: Uint8Array;

beforeAll(async () => {
  const s = await createUser("guias.staff@compichef.com");
  const c = await createUser("guias.chef@compichef.com");
  const x = await createUser("guias.fuera@compichef.com");
  await addStaff(s, H, 3);
  await addStaff(c, H, 1);
  await addStaff(x, "hotel-ajeno", 3);
  staff = await tokenFor(s);
  chef = await tokenFor(c, { aal: "aal2" });
  outsider = await tokenFor(x);

  await pool.query(
    `insert into public.compi_arts_outlets (hotel_key, outlet_key, hotel, outlet) values ($1, $2, 'Hotel Guías', 'Enoteca')`,
    [H, O],
  );
  await pool.query(
    `insert into public.compi_arts_guides (hotel_key, outlet_key, guide_key, hotel, outlet, title, guide_state)
     values ($1, $2, $3, 'Hotel Guías', 'Enoteca', 'Arroz', 'ready')`,
    [H, O, G],
  );

  // Stored files: a real PDF (not a legacy CompI template) and a placeholder Word file.
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  pdf = await doc.save();
  const docx = new TextEncoder().encode("placeholder docx");
  const approved = png(1), clean = png(2);
  for (const [fmt, data] of [["pdf", pdf], ["docx", docx]] as const) {
    await store.put("compi-arts-catalog", `${prefix}validated/${sha(data)}/ficha.${fmt}`, data, "application/octet-stream");
    await pool.query(
      `insert into compi_private.arts_validated_files (hotel_key, outlet_key, guide_key, format, digest) values ($1, $2, $3, $4, $5)`,
      [H, O, G, fmt, sha(data)],
    );
  }
  await store.put("compi-arts-media", `${prefix}source/image/${sha(approved)}`, approved, "image/png");
  await store.put("compi-arts-media", `${prefix}source/art/${sha(clean)}`, clean, "image/png");
  const source = {
    data: { pasos: [{ accion: "Servir el arroz", control: "En plato hondo" }, { accion: "Colocar el carabinero" }], pase: "8 min", racion: "1" },
    imagen_aprobada: { tipo: "acuarela", sha256: sha(approved) },
    assets: { art: { sha256: sha(clean) } },
  };
  await pool.query(
    `insert into compi_private.arts_guide_sources (hotel_key, outlet_key, guide_key, revision, source, docx_sha, pdf_sha)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [H, O, G, randomUUID(), source, sha(docx), sha(pdf)],
  );
});

afterAll(close);

const path = `/v1/guides/${H}/${O}/${G}`;
const call = (p: string, init?: RequestInit) => app.request(p, init);

describe("guide detail", () => {
  it("returns the steps and service data", async () => {
    const body = await json(call(path, bearer(staff)));
    // workspace_data() normalizes steps: a missing control comes back as null.
    expect(body.data.pasos).toEqual([
      { accion: "Servir el arroz", control: "En plato hondo" },
      { accion: "Colocar el carabinero", control: null },
    ]);
    expect(body.data.pase).toBe("8 min");
  });

  it("is refused to people from other hotels", async () => {
    expect((await call(path, bearer(outsider))).status).toBe(403);
  });

  it("validates the guide keys", async () => {
    expect((await call("/v1/guides/Hotel%20X/o/g", bearer(staff))).status).toBe(422);
  });
});

describe("review and classification", () => {
  it("records the review per user", async () => {
    const put = (reviewed: boolean) =>
      call(`${path}/review`, { method: "PUT", headers: { ...bearer(staff).headers, "Content-Type": "application/json" }, body: JSON.stringify({ reviewed }) });
    expect(await json(put(true))).toEqual({ reviewed: true });
    const catalog = await json(call("/v1/guides", bearer(staff)));
    expect(catalog.items.find((g: { guideKey: string }) => g.guideKey === G).reviewed).toBe(true);
    expect(await json(put(false))).toEqual({ reviewed: false });
  });

  it("lets editors classify, not staff", async () => {
    const put = (token: string) =>
      call(`${path}/classification`, {
        method: "PUT",
        headers: { ...bearer(token).headers, "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "plato", category: "principales" }),
      });
    expect((await put(staff)).status).toBe(403);
    expect((await put(chef)).status).toBe(204);
    const catalog = await json(call("/v1/guides", bearer(staff)));
    expect(catalog.items.find((g: { guideKey: string }) => g.guideKey === G)).toMatchObject({ kind: "plato", category: "principales" });
  });
});

describe("images", () => {
  it("serves the annotated and the clean image, checking their digests", async () => {
    const approved = await call(`${path}/media/approved`, bearer(staff));
    expect(approved.status).toBe(200);
    expect(approved.headers.get("content-type")).toBe("image/png");
    expect(approved.headers.get("cache-control")).toContain("no-store");
    expect(new Uint8Array(await approved.arrayBuffer())).toEqual(png(1));
    const clean = await call(`${path}/media/clean`, bearer(staff));
    expect(new Uint8Array(await clean.arrayBuffer())).toEqual(png(2));
  });

  it("is refused to people from other hotels", async () => {
    expect((await call(`${path}/media/approved`, bearer(outsider))).status).toBe(403);
  });
});

describe("document downloads", () => {
  it("serves the stored file with the brand revision when the hotel has no brand configured", async () => {
    // Without a configured brand, only CompI master templates are re-branded;
    // other files are returned unchanged (legacy rebrand.js `onlyMaster`).
    for (const query of ["", "?original=1"]) {
      const res = await call(`${path}/files/pdf${query}`, bearer(staff));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/pdf");
      expect(res.headers.get("x-compi-brand-revision")).toMatch(/^\d+$/);
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(pdf);
    }
  });

  it("is refused to people from other hotels", async () => {
    expect((await call(`${path}/files/pdf?original=1`, bearer(outsider))).status).toBe(403);
  });
});
