// Copies the PDF.js assets react-pdf needs (CMaps, standard fonts, WASM
// decoders, ICC profiles) from pdfjs-dist into public/pdfjs, so documents
// render without any CDN. Runs before `dev` and `build`.
import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pdfjs = dirname(require.resolve("pdfjs-dist/package.json", { paths: [dirname(require.resolve("react-pdf"))] }));
const target = new URL("../public/pdfjs/", import.meta.url).pathname;
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  await cp(join(pdfjs, dir), join(target, dir), { recursive: true }).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}
console.log("PDF.js assets copied to public/pdfjs");
