// Port of legacy/public/content-language.js: hotel content (dish names,
// steps, notes) is written in Spanish; in another UI language it is machine
// translated on this device with Mozilla's Bergamot (Firefox Translations)
// engine. Only public language models are downloaded; hotel content never
// leaves the browser. The engine files live in /public/vendor/bergamot.

type Engine = { translate(from: string, to: string, texts: string[]): Promise<string[]>; dispose(): void };

const memo = new Map<string, string>();
const knownNames = new Set(["CompI", "Hotel Arts Barcelona", "Marina", "IRD", "Oleos", "Óleos", "Plaza", "Bites & Sips", "Bites and Sips"]);
let engine: Engine | null = null;
let engineLanguage = "";
let chain: Promise<unknown> = Promise.resolve();
let generation = 0;

export function keepNames(names: (string | null | undefined)[]) {
  for (const s of names) if (s) knownNames.add(s);
}
const token = /\b(?:[A-Z]{2,}(?:[-_/][\w-]+)+|\d+(?:[.,:/-]\d+)*(?:\s?°[CF])?)\b/gu;
const numbers = (s: string) => s.match(token)?.join("|") ?? "";
/** Text that stays as written: no letters, known names, emails, URLs, quantities. */
export function fixed(s: string) {
  return (
    !/\p{L}/u.test(s) ||
    knownNames.has(s) ||
    /^(?:[^\s@]+@[^\s@]+|https?:\/\/\S+|[\d\s.,/%()+–−€°-]*(?:g|kg|ml|cl|l|cm|mm|min|kcal|°C|€|%)[\d\s./%°-]*)$/iu.test(s)
  );
}
const key = (s: string, to: string, from: string) => `${from}\0${to}\0${s}`;
export const shownText = (s: string, to: string, from = "es") => memo.get(key(s, to, from)) ?? s;
/** An approved translation (e.g. the recipe's English name) wins over the machine. */
export function approveTranslation(es: string | null | undefined, en: string | null | undefined) {
  if (es && en && es !== en) memo.set(key(es, "en", "es"), en);
}

async function runtime(target: string): Promise<Engine> {
  // Calls are serialized; release the previous pair before loading another language (tablets).
  if (engine && engineLanguage !== target) {
    engine.dispose();
    engine = null;
  }
  engineLanguage = target;
  if (!engine) {
    const url = "/vendor/bergamot/engine.js";
    const { BergamotEngine } = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url);
    engine ??= new BergamotEngine({ runtimePath: "/vendor/bergamot/" }) as Engine;
  }
  return engine;
}

export function clearLanguageContent() {
  ++generation;
  memo.clear();
  engine?.dispose();
  engine = null;
}

export async function translateTexts(values: string[], to: string, from = "es"): Promise<string[]> {
  if (from === to) return [...values];
  const rev = generation;
  const aborted = () => new DOMException("Session changed", "AbortError");
  const run = async () => {
    if (rev !== generation) throw aborted();
    const missing = [...new Set(values)].filter((s) => s && !fixed(s) && !memo.has(key(s, to, from)));
    if (missing.length) {
      const mt = await runtime(to);
      for (let i = 0; i < missing.length; i += 32) {
        const raw = missing.slice(i, i + 32);
        const translated = await mt.translate(from, to, raw);
        if (rev !== generation) throw aborted();
        for (let j = 0; j < raw.length; j++) {
          const s = raw[j]!;
          let value = translated[j]?.trim();
          if (!value) throw new Error("Empty translation");
          if (numbers(value) !== numbers(s)) {
            // Translate only the surrounding words if the model reformats a quantity or document code.
            const parts = s.split(new RegExp(`(${token.source})`, token.flags));
            const words = parts.filter((p, k) => k % 2 === 0 && p.trim() && !fixed(p));
            const output = words.length ? await mt.translate(from, to, words.map((x) => x.trim())) : [];
            const dict = new Map(words.map((p, k) => [p, p.replace(p.trim(), output[k] || p.trim())]));
            value = parts.map((p, k) => (k % 2 === 0 ? (dict.get(p) ?? p) : p)).join("");
          }
          if (rev !== generation) throw aborted();
          memo.set(key(s, to, from), value);
        }
      }
    }
    return values.map((s) => shownText(s, to, from));
  };
  const task = chain.then(run, run);
  chain = task.catch(() => {});
  return task;
}
