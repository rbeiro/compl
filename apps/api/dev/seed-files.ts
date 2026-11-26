// Demo guide content for local development (run by `db:local` after
// dev/seed.sql): one structured guide with steps, an annotated and a clean
// watercolor and PDF/Word files, and one guide that only has a Word file.
// Files go to the local object store used by the dev API (LOCAL_STORAGE_DIR).
import { createHash, randomUUID } from "node:crypto";
import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import pg from "pg";
import { PNG } from "pngjs";
import { createLocalStore } from "../src/storage/local-store.js";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** A plate-like drawing: ivory background, a round plate, optional label boxes. */
function plate(labels: boolean): Uint8Array {
  const png = new PNG({ width: 800, height: 600 });
  for (let y = 0; y < 600; y++) {
    for (let x = 0; x < 800; x++) {
      const i = (800 * y + x) << 2;
      const d = Math.hypot(x - 400, y - 300);
      let [r, g, b] = [250, 247, 242];
      if (d < 230) [r, g, b] = [236, 230, 218];
      if (d < 120) [r, g, b] = [196, 120, 70 + Math.round(d / 4)];
      if (labels && ((x > 560 && x < 760 && y > 80 && y < 120) || (x > 40 && x < 240 && y > 470 && y < 510))) [r, g, b] = [35, 96, 63];
      png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
    }
  }
  return new Uint8Array(PNG.sync.write(png));
}

async function pdfFor(title: string) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  page.drawText(title, { x: 50, y: 780, size: 24, font: await doc.embedFont(StandardFonts.Helvetica) });
  return doc.save();
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const row = (...cells: string[]) => `<w:tr>${cells.map((c) => `<w:tc>${p(c)}</w:tc>`).join("")}</w:tr>`;

async function wordGuide(steps: [string, string][], photo?: Uint8Array) {
  const zip = new JSZip();
  const drawing = photo
    ? `<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Foto_1" descr="Fotografía de emplatado"/>
       <a:graphic><a:graphicData><a:blip r:embed="rId5"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
    : "";
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}
      xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>
      ${p("Partida [Fríos] · Tiempo de pase [4 min] · Ración [2 uds] · V [3]")}${drawing}
      <w:tbl>${row("Paso", "Acción", "Control")}${steps.map(([a, c], i) => row(String(i + 1), a, c)).join("")}</w:tbl>
    </w:body></w:document>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
     ${photo ? '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>' : ""}
     </Relationships>`,
  );
  if (photo) zip.file("word/media/image1.png", photo);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export async function seedFiles(databaseUrl: string, storageDir: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const store = createLocalStore(storageDir, pool);
  const H = "hotel-arts-barcelona";
  try {
    // Structured guide: Arroz de carabinero (Enoteca).
    {
      const O = "enoteca", G = "arroz-de-carabinero", prefix = `${H}/${O}/plating-guides/${G}/`;
      const approved = plate(true), clean = plate(false);
      const pdf = await pdfFor("Arroz de carabinero");
      const docx = await wordGuide([["Servir el arroz", "Capa fina y uniforme"]]);
      for (const [fmt, data] of [["pdf", pdf], ["docx", docx]] as const) {
        await store.put("compi-arts-catalog", `${prefix}validated/${sha(data)}/ficha.${fmt}`, data, "application/octet-stream");
        await pool.query(
          "insert into compi_private.arts_validated_files (hotel_key, outlet_key, guide_key, format, digest) values ($1,$2,$3,$4,$5)",
          [H, O, G, fmt, sha(data)],
        );
      }
      await store.put("compi-arts-media", `${prefix}source/image/${sha(approved)}`, approved, "image/png");
      await store.put("compi-arts-media", `${prefix}source/art/${sha(clean)}`, clean, "image/png");
      const source = {
        data: {
          pasos: [
            { accion: "Servir el arroz en la paellera", control: "Capa fina y uniforme, sin tocar el borde" },
            { accion: "Colocar el carabinero en el centro", control: "Cabeza hacia el pase" },
            { accion: "Terminar con el alioli", control: "Tres puntos a la derecha" },
          ],
          ingredientes: [
            { nombre: "Arroz bomba", cantidad: "80", unidad: "g" },
            { nombre: "Carabinero", cantidad: "1", unidad: "ud" },
            { nombre: "Fumet de marisco", cantidad: "250", unidad: "ml" },
          ],
          pase: "12 min",
          racion: "1 ud",
          version: "2",
          partida: "Calientes",
        },
        imagen_aprobada: { tipo: "acuarela", sha256: sha(approved) },
        assets: { art: { sha256: sha(clean) } },
      };
      await pool.query(
        `insert into compi_private.arts_guide_sources (hotel_key, outlet_key, guide_key, revision, source, docx_sha, pdf_sha)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [H, O, G, randomUUID(), source, sha(docx), sha(pdf)],
      );
    }
    // Word-only guide: Ostra y manzana (P41).
    {
      const O = "p41", G = "ostra-y-manzana", prefix = `${H}/${O}/plating-guides/${G}/`;
      const docx = await wordGuide(
        [["Abrir la ostra", "Conservar el agua"], ["Añadir la manzana", "En brunoise fina"]],
        plate(false),
      );
      await store.put("compi-arts-catalog", `${prefix}validated/${sha(docx)}/ficha.docx`, docx, "application/octet-stream");
      await pool.query(
        "insert into compi_private.arts_validated_files (hotel_key, outlet_key, guide_key, format, digest) values ($1,$2,$3,'docx',$4)",
        [H, O, G, sha(docx)],
      );
    }
  } finally {
    await pool.end();
  }
}
