import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupApp } from "./fixtures.js";

const { app, pool, createUser, addStaff, tokenFor, close } = await setupApp();
const H = "hotel-edicion";
let chef: string, editor: string, staff: string;

const call = (token: string, method: string, path: string, body?: unknown, type = "application/json") =>
  app.request(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": type } : {}) },
    body: body === undefined ? undefined : body instanceof Uint8Array ? (body as unknown as ArrayBuffer) : JSON.stringify(body),
  });

async function pdf() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  return doc.save();
}
async function docx() {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hola</w:t></w:r></w:p></w:body></w:document>',
  );
  return zip.generateAsync({ type: "uint8array" });
}

beforeAll(async () => {
  const [c, e, s] = await Promise.all([createUser("ed.chef@compichef.com"), createUser("ed.editor@compichef.com"), createUser("ed.staff@compichef.com")]);
  await addStaff(c!, H, 1);
  await addStaff(e!, H, 2);
  await addStaff(s!, H, 3);
  chef = await tokenFor(c!, { aal: "aal2" });
  editor = await tokenFor(e!);
  staff = await tokenFor(s!);
  await pool.query(`insert into public.compi_arts_outlets (hotel_key, outlet_key, hotel, outlet) values ($1, 'cocina', 'Hotel Edición', 'Cocina')`, [H]);
});
afterAll(close);

describe("catalog editing and uploads", () => {
  let outlet: string;
  let guide: string;

  it("lets the executive chef create and rename folders", async () => {
    expect((await call(editor, "POST", `/v1/hotels/${H}/outlets`, { name: "Terraza" })).status).toBe(403);
    const res = await call(chef, "POST", `/v1/hotels/${H}/outlets`, { name: "Terraza" });
    expect(res.status).toBe(201);
    outlet = ((await res.json()) as { key: string }).key;
    expect((await call(chef, "PATCH", `/v1/hotels/${H}/outlets/${outlet}`, { name: "Terraza Sur" })).status).toBe(204);
    expect((await call(chef, "PATCH", `/v1/hotels/${H}/outlets/${outlet}`, { name: "a/b" })).status).toBe(422);
    const { rows } = await pool.query("select outlet from public.compi_arts_outlets where outlet_key = $1", [outlet]);
    expect(rows[0].outlet).toBe("Terraza Sur");
  });

  it("lets editors create a draft, upload both files and publish it", async () => {
    expect((await call(staff, "POST", `/v1/hotels/${H}/outlets/${outlet}/guides`, { name: "Gazpacho" })).status).toBe(403);
    const res = await call(editor, "POST", `/v1/hotels/${H}/outlets/${outlet}/guides`, { name: "Gazpacho" });
    expect(res.status).toBe(201);
    guide = ((await res.json()) as { key: string }).key;
    const base = `/v1/guides/${H}/${outlet}/${guide}`;

    const publishEarly = await call(editor, "POST", `${base}/publish`);
    expect(publishEarly.status).toBe(409);
    expect(((await publishEarly.json()) as any).error.detail).toBe("Valida y sube tanto el Word como el PDF antes de publicar.");

    const bad = await call(editor, "PUT", `${base}/files/pdf`, new TextEncoder().encode("not a pdf at all"), "application/pdf");
    expect(bad.status).toBe(422);
    const up = await call(editor, "PUT", `${base}/files/pdf`, await pdf(), "application/pdf");
    expect(up.status).toBe(204);
    const upw = await call(editor, "PUT", `${base}/files/docx`, await docx(), "application/octet-stream");
    expect(upw.status).toBe(204);
    expect((await call(editor, "PATCH", base, { name: "Gazpacho andaluz" })).status).toBe(204);
    expect((await call(editor, "POST", `${base}/publish`)).status).toBe(204);
    const { rows } = await pool.query("select guide_state, title from public.compi_arts_guides where guide_key = $1", [guide]);
    expect(rows[0]).toEqual({ guide_state: "ready", title: "Gazpacho andaluz" });

    // The published file downloads.
    const download = await call(staff, "GET", `${base}/files/pdf?original=1`);
    expect(download.status).toBe(200);
  });

  it("rejects files over 10 MB", async () => {
    const res = await call(editor, "PUT", `/v1/guides/${H}/${outlet}/${guide}/files/pdf`, new Uint8Array(10 * 1024 * 1024 + 1), "application/pdf");
    expect(res.status).toBe(413);
  });

  it("removes guides and folders (executive chef)", async () => {
    expect((await call(editor, "DELETE", `/v1/guides/${H}/${outlet}/${guide}`)).status).toBe(403);
    expect((await call(chef, "DELETE", `/v1/guides/${H}/${outlet}/${guide}`)).status).toBe(204);
    expect((await call(chef, "DELETE", `/v1/hotels/${H}/outlets/${outlet}`)).status).toBe(204);
    expect((await call(chef, "PATCH", `/v1/hotels/${H}/outlets/${outlet}`, { name: "Otra" })).status).toBe(404);
  });
});
