// work/i18n/local-cache.ts
var TRANSLATE_CACHE_NAME = "compi-language-models-v1";

// work/i18n/local-registry.ts
var RUNTIME_CDN = "https://cdn.jsdelivr.net/npm/@mkljczk/bergamot-translator@0.4.16/worker/";
var PAIRS = {
  "ar-en": { from: "ar", to: "en", architecture: "base-memory", revision: "retrain_base-memory_X9fDxFreTOCslPKzb1CXTg", bytes: 31561787, params: 31248966, comet: 0.8597, files: { model: "model.aren.intgemm.alphas.bin", lex: "lex.50.50.aren.s2t.bin", vocab: "vocab.aren.spm" } },
  "ca-en": { from: "ca", to: "en", architecture: "base-memory", revision: "target-side-dedup_xxxxxxxxRxSxxxxxxxxxxA", bytes: 31561787, params: 31248966, comet: 0.8777, files: { model: "model.caen.intgemm.alphas.bin", lex: "lex.50.50.caen.s2t.bin", vocab: "vocab.caen.spm" } },
  "en-ar": { from: "en", to: "ar", architecture: "base-memory", revision: "retrain_base-memory_G3CmhwG_TZext3cys-udHg", bytes: 31561787, params: 31248966, comet: 0.8596, files: { model: "model.enar.intgemm.alphas.bin", lex: "lex.50.50.enar.s2t.bin", vocab: "vocab.enar.spm" } },
  "en-ca": { from: "en", to: "ca", architecture: "base-memory", revision: "short-sentences_dqpjVFEaT2WLVB2nV0_H2g", bytes: 31561787, params: 31248966, comet: 0.8696, files: { model: "model.enca.intgemm.alphas.bin", lex: "lex.50.50.enca.s2t.bin", vocab: "vocab.enca.spm" } },
  "en-es": { from: "en", to: "es", architecture: "base-memory", revision: "retrain_hr_fix_names_CUAEXUHoQum_cFqh-ZAryw", bytes: 31561787, params: 31248966, comet: 0.854, files: { model: "model.enes.intgemm.alphas.bin", lex: "lex.50.50.enes.s2t.bin", vocab: "vocab.enes.spm" } },
  "en-fr": { from: "en", to: "fr", architecture: "base-memory", revision: "retrain_hr_NLIxDbE1TBGyOTI-zwZagw", bytes: 31561787, params: 31248966, comet: 0.8653, files: { model: "model.enfr.intgemm.alphas.bin", lex: "lex.50.50.enfr.s2t.bin", vocab: "vocab.enfr.spm" } },
  "en-it": { from: "en", to: "it", architecture: "base-memory", revision: "retrain_hr_fix_names_GPSr_u8PSmC9fOx1ZDCHoA", bytes: 31561787, params: 31248966, comet: 0.8655, files: { model: "model.enit.intgemm.alphas.bin", lex: "lex.50.50.enit.s2t.bin", vocab: "vocab.enit.spm" } },
  "en-pt": { from: "en", to: "pt", architecture: "base-memory", revision: "retrain_hr_fix_names_Vnb0RUXTTd67hR-oLHM3eg", bytes: 31561787, params: 31248966, comet: 0.8889, files: { model: "model.enpt.intgemm.alphas.bin", lex: "lex.50.50.enpt.s2t.bin", vocab: "vocab.enpt.spm" } },
  "es-en": { from: "es", to: "en", architecture: "base-memory", revision: "retrain_hr_HbNjJ60BTwmVTbhfFxuduA", bytes: 31561787, params: 31248966, comet: 0.8572, files: { model: "model.esen.intgemm.alphas.bin", lex: "lex.50.50.esen.s2t.bin", vocab: "vocab.esen.spm" } },
  "fr-en": { from: "fr", to: "en", architecture: "base-memory", revision: "retrain_hr_EFgIftH_RrCyzl5gjemVNg", bytes: 31561787, params: 31248966, comet: 0.886, files: { model: "model.fren.intgemm.alphas.bin", lex: "lex.50.50.fren.s2t.bin", vocab: "vocab.fren.spm" } },
  "it-en": { from: "it", to: "en", architecture: "base-memory", revision: "retrain_hr_d1nPDwVeSD6t-HdtWA4xNg", bytes: 31561787, params: 31248966, comet: 0.8691, files: { model: "model.iten.intgemm.alphas.bin", lex: "lex.50.50.iten.s2t.bin", vocab: "vocab.iten.spm" } },
  "pt-en": { from: "pt", to: "en", architecture: "base-memory", revision: "retrain_hr_drxrs5bGSsOWvfK9lyZISw", bytes: 31561787, params: 31248966, comet: 0.8871, files: { model: "model.pten.intgemm.alphas.bin", lex: "lex.50.50.pten.s2t.bin", vocab: "vocab.pten.spm" } }
};

// work/i18n/local-engine.ts
var DEFAULT_MODEL_PATH = "https://huggingface.co/midudev/firefox-translations/resolve/6f6acd72c26975a06a8e61b72d1fbacbd184c23f/";
function normalize(code) {
  const c = code.trim();
  if (/^zh[-_]hans$/i.test(c) || /^zh[-_]cn$/i.test(c)) return "zh";
  if (/^zh[-_]hant$/i.test(c) || /^zh[-_]tw$/i.test(c)) return "zh-Hant";
  return c.toLowerCase().split(/[-_]/)[0] ?? c;
}
function resolveRoute(from, to) {
  const src = normalize(from);
  const tgt = normalize(to);
  if (src === tgt) return null;
  const direct = PAIRS[`${src}-${tgt}`];
  if (direct) return [direct];
  const outbound = PAIRS[`${src}-en`];
  const inbound = PAIRS[`en-${tgt}`];
  if (outbound && inbound) return [outbound, inbound];
  return null;
}
function hasPair(from, to) {
  return resolveRoute(from, to) !== null;
}
function keyOf(entry) {
  return `${entry.from}-${entry.to}`;
}
function absolute(base) {
  const withSlash = base.endsWith("/") ? base : `${base}/`;
  if (/^[a-z]+:/i.test(withSlash)) return withSlash;
  const origin = typeof location !== "undefined" ? location.href : "http://localhost/";
  return new URL(withSlash, origin).href;
}
function joinUrl(base, path) {
  return base + path;
}
async function openCache() {
  try {
    if (typeof caches === "undefined") return null;
    return await caches.open(TRANSLATE_CACHE_NAME);
  } catch {
    return null;
  }
}
async function readWithProgress(res, onChunk) {
  const total = Number(res.headers.get("content-length") ?? 0);
  if (!res.body) return res.arrayBuffer();
  const reader = res.body.getReader();
  if (total > 0) {
    let out2 = new Uint8Array(total);
    let loaded2 = 0;
    let lastEmit2 = 0;
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      if (loaded2 + value.byteLength > out2.byteLength) {
        const grown = new Uint8Array(Math.max(out2.byteLength * 2, loaded2 + value.byteLength));
        grown.set(out2.subarray(0, loaded2));
        out2 = grown;
      }
      out2.set(value, loaded2);
      loaded2 += value.byteLength;
      const now = performance.now();
      if (loaded2 >= total || now - lastEmit2 >= 32) {
        lastEmit2 = now;
        onChunk(loaded2, total);
      }
    }
    const finalBytes = loaded2 === out2.byteLength ? out2 : out2.subarray(0, loaded2);
    return finalBytes.byteOffset === 0 && finalBytes.byteLength === finalBytes.buffer.byteLength ? finalBytes.buffer : finalBytes.slice().buffer;
  }
  const chunks = [];
  let loaded = 0;
  let lastEmit = 0;
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    const now = performance.now();
    if (now - lastEmit >= 32) {
      lastEmit = now;
      onChunk(loaded, total);
    }
  }
  onChunk(loaded, total);
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out.buffer;
}
async function fetchFile(url, file, onProgress, cachePromise) {
  const cache = await cachePromise;
  const hit = await cache?.match(url);
  if (hit) {
    onProgress?.({ status: "progress", file, progress: 100 });
    return hit.arrayBuffer();
  }
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) throw new Error(`Could not download ${file} (HTTP ${res.status}) from ${url}`);
  const buffer = await readWithProgress(res, (loaded, total) => {
    onProgress?.({
      status: "progress",
      file,
      progress: total > 0 ? loaded / total * 100 : void 0,
      loaded,
      total: total > 0 ? total : void 0
    });
  });
  if (cache) {
    void cache.put(
      url,
      new Response(buffer, {
        headers: { "Content-Type": "application/octet-stream", "Content-Length": String(buffer.byteLength) }
      })
    ).catch(() => {
    });
  }
  return buffer;
}
var BergamotEngine = class {
  #modelPath;
  #runtimePath;
  #onProgress;
  #worker = null;
  #workerUrl = null;
  #ready = null;
  #pending = /* @__PURE__ */ new Map();
  #nextId = 1;
  #loaded = /* @__PURE__ */ new Map();
  constructor(options = {}) {
    this.#modelPath = absolute(options.modelPath ?? DEFAULT_MODEL_PATH);
    this.#runtimePath = absolute(options.runtimePath ?? RUNTIME_CDN);
    this.#onProgress = options.onProgress;
  }
  get modelPath() {
    return this.#modelPath;
  }
  #call(name, args, transfer = []) {
    const worker = this.#worker;
    if (!worker) return Promise.reject(new Error("Translator has been disposed"));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      worker.postMessage({ id, name, args }, transfer);
    });
  }
  /** Boot the worker and instantiate the WASM runtime. Idempotent. */
  init() {
    if (this.#ready) return this.#ready;
    if (typeof Worker === "undefined" || typeof Blob === "undefined") {
      return Promise.reject(new Error("runonweb/translate needs a browser with Web Workers"));
    }
    this.#onProgress?.({ status: "loading", progress: 0 });
    this.#ready = (async () => {
      const worker = new Worker("/vendor/bergamot/worker.js");
      this.#worker = worker;
      worker.addEventListener("message", (event) => {
        const { id, result, error } = event.data;
        const pending = this.#pending.get(id);
        if (!pending) return;
        this.#pending.delete(id);
        if (error) {
          const err = new Error(error.message ?? "Worker error");
          if (error.name) err.name = error.name;
          if (error.stack) err.stack = error.stack;
          pending.reject(err);
        } else {
          pending.resolve(result);
        }
      });
      worker.addEventListener("error", (event) => {
        const err = new Error(event.message || "Translation worker crashed");
        for (const p of this.#pending.values()) p.reject(err);
        this.#pending.clear();
      });
      await this.#call("init", { runtimePath: this.#runtimePath });
    })().catch((err) => {
      this.#ready = null;
      throw err;
    });
    return this.#ready;
  }
  #fileUrl(entry, name) {
    return joinUrl(this.#modelPath, `${keyOf(entry)}/${name}?rev=${encodeURIComponent(entry.revision)}`);
  }
  async #loadEntry(entry) {
    const key = keyOf(entry);
    const existing = this.#loaded.get(key);
    if (existing) return existing;
    const promise = (async () => {
      const f = entry.files;
      const vocabNames = f.vocab ? [f.vocab] : [f.srcvocab, f.trgvocab];
      const cachePromise = openCache();
      const [, [model, lex, ...vocabs]] = await Promise.all([
        this.init(),
        Promise.all(
          [f.model, f.lex, ...vocabNames].map(
            (name) => fetchFile(this.#fileUrl(entry, name), name, this.#onProgress, cachePromise)
          )
        )
      ]);
      this.#onProgress?.({ status: "loading", file: key });
      await this.#call("loadModel", { key, modelName: f.model, model, lex, vocabs }, [model, lex, ...vocabs]);
    })();
    this.#loaded.set(key, promise);
    promise.catch(() => this.#loaded.delete(key));
    return promise;
  }
  /** Download (or read from cache) and instantiate every model needed for `from → to`. */
  async load(from, to) {
    const route = resolveRoute(from, to);
    if (!route) {
      throw new Error(
        `No Firefox Translations model for ${from} \u2192 ${to}. See PAIRS in 'runonweb/translate' for the supported pairs.`
      );
    }
    await Promise.all(route.map((entry) => this.#loadEntry(entry)));
    this.#onProgress?.({ status: "ready", progress: 100 });
    return route;
  }
  /** Translate one or more texts. Models are loaded on demand. */
  async translate(from, to, texts, options = {}) {
    const route = await this.load(from, to);
    return this.#call("translate", { route: route.map(keyOf), texts, html: options.html ?? false });
  }
  /** Free a pair from WASM memory. */
  async unload(from, to) {
    const route = resolveRoute(from, to) ?? [];
    for (const entry of route) {
      const key = keyOf(entry);
      if (!this.#loaded.has(key)) continue;
      this.#loaded.delete(key);
      await this.#call("freeModel", { key });
    }
  }
  dispose() {
    const worker = this.#worker;
    this.#worker = null;
    this.#ready = null;
    this.#loaded.clear();
    const err = new Error("Translator disposed");
    for (const p of this.#pending.values()) p.reject(err);
    this.#pending.clear();
    worker?.terminate();
    if (this.#workerUrl) URL.revokeObjectURL(this.#workerUrl);
    this.#workerUrl = null;
  }
};
export {
  BergamotEngine,
  DEFAULT_MODEL_PATH,
  hasPair,
  resolveRoute
};
