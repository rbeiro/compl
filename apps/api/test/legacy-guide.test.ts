import { createHash } from "node:crypto";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, json, setupApp } from "./fixtures.js";

const { app, pool, store, createUser, addStaff, tokenFor, close } = await setupApp();
const H = "hotel-word", O = "bar", G = "tartar";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const photo = new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70]);

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const row = (...cells: string[]) => `<w:tr>${cells.map((c) => `<w:tc>${p(c)}</w:tc>`).join("")}</w:tr>`;
const documentXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document ${W} xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>
${p("Partida [Fríos] · Tiempo de pase [5 min] · Ración [1 ud]")}
<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Imagen 1" descr="Fotografía de emplatado del tartar"/>
<a:graphic><a:graphicData><a:blip r:embed="rId5"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
<w:tbl>${row("Ingrediente", "Cantidad", "Unidad")}${row("Atún", "120", "g")}</w:tbl>
<w:tbl>${row("Paso", "Acción", "Control")}${row("1", "Cortar el atún", "En dados")}${row("2", "Emplatar", "")}</w:tbl>
</w:body></w:document>`;
const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.jpeg"/>
</Relationships>`;

let staff: string;
beforeAll(async () => {
  const s = await createUser("word.staff@compichef.com");
  await addStaff(s, H, 3);
  staff = await tokenFor(s);
  await pool.query(`insert into public.compi_arts_outlets (hotel_key, outlet_key, hotel, outlet) values ($1, $2, 'Hotel Word', 'Bar')`, [H, O]);
  await pool.query(
    `insert into public.compi_arts_guides (hotel_key, outlet_key, guide_key, hotel, outlet, title) values ($1, $2, $3, 'Hotel Word', 'Bar', 'Tartar')`,
    [H, O, G],
  );
  const zip = new JSZip();
  zip.file("word/document.xml", documentXml);
  zip.file("word/_rels/document.xml.rels", relsXml);
  zip.file("word/media/image1.jpeg", photo);
  const docx = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  await store.put("compi-arts-catalog", `${H}/${O}/plating-guides/${G}/validated/${sha(docx)}/ficha.docx`, docx, "application/octet-stream");
  await pool.query(
    `insert into compi_private.arts_validated_files (hotel_key, outlet_key, guide_key, format, digest) values ($1, $2, $3, 'docx', $4)`,
    [H, O, G, sha(docx)],
  );
});

afterAll(close);

describe("guides that only exist as a Word file", () => {
  it("reads the service data, ingredients and steps", async () => {
    const body = await json(app.request(`/v1/guides/${H}/${O}/${G}/legacy`, bearer(staff)));
    expect(body.hasImage).toBe(true);
    expect(body.data).toMatchObject({
      partida: "Fríos",
      pase: "5 min",
      racion: "1 ud",
      ingredientes: [{ nombre: "Atún", cantidad: "120", unidad: "g" }],
      pasos: [
        { accion: "Cortar el atún", control: "En dados" },
        { accion: "Emplatar", control: "" },
      ],
    });
  });

  it("serves the captioned dish photo", async () => {
    const res = await app.request(`/v1/guides/${H}/${O}/${G}/legacy/image`, bearer(staff));
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(photo);
  });
});
