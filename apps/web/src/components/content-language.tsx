"use client";

import { useLocale } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { clearLanguageContent, fixed, translateTexts } from "@/lib/content-language";

// Port of observeContent() in legacy/public/content-language.js. Legacy
// translated every text it did not recognise as interface copy; here the
// interface comes translated from next-intl, so only hotel content is
// translated: text inside elements marked dir="auto" or data-content-lang
// (how every screen marks content), never inside translate="no".

const status: Record<string, [string, string]> = {
  es: ["Traduciendo…", "No se pudo cargar la traducción. Reintentar"],
  en: ["Translating…", "Translation could not load. Retry"],
  ca: ["S’està traduint…", "No s’ha pogut carregar la traducció. Torna-ho a provar"],
  it: ["Traduzione in corso…", "Impossibile caricare la traduzione. Riprova"],
  pt: ["A traduzir…", "Não foi possível carregar a tradução. Tentar novamente"],
  fr: ["Traduction en cours…", "Impossible de charger la traduction. Réessayer"],
  ar: ["جارٍ الترجمة…", "تعذّر تحميل الترجمة. أعد المحاولة"],
};
const skip = 'script,style,svg,code,textarea,input,select,[contenteditable="true"],[translate="no"],[data-language-picker],.pdf-page-canvas,.language-progress';
const content = '[dir="auto"],[data-content-lang]';
const attrs = ["placeholder", "title", "aria-label", "alt"] as const;
type State = { source: string; last: string; lang: string };

export function ContentLanguage() {
  const lang = useLocale();
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(false);
  const retry = useRef<() => void>(() => {});

  useEffect(() => {
    if (lang === "es" || typeof MutationObserver === "undefined" || typeof Worker === "undefined") return;
    const records = new WeakMap<Node, Map<string, State>>();
    const targets = new Set<Node>();
    let timer = 0;
    let live = true;

    const queue = (root: Node | null) => {
      if (!root) return;
      targets.add(root);
      if (!timer) timer = window.setTimeout(flush, 35);
    };
    async function flush() {
      timer = 0;
      const roots = [...targets];
      targets.clear();
      const groups = new Map<string, Map<string, ((v: string) => void)[]>>();
      const collect = (node: Node, attr: string) => {
        const parent = attr ? (node as Element) : node.parentElement;
        if (!parent || parent.closest(skip) || !parent.closest(content)) return;
        const read = () => (attr ? (node as Element).getAttribute(attr) : (node as Text).data);
        const value = read();
        if (!value?.trim()) return;
        let states = records.get(node);
        if (!states) records.set(node, (states = new Map()));
        let state = states.get(attr);
        if (!state || value !== state.last) {
          state = { source: value, last: value, lang: "" };
          states.set(attr, state);
        }
        if (state.lang === lang) return;
        const original = state.source.trim();
        const from = (parent.closest("[data-content-lang]") as HTMLElement | null)?.dataset.contentLang || "es";
        const current = state;
        const write = (v: string) => {
          if (!live || !node.isConnected || read() !== current.last) return;
          const out = current.source.replace(original, () => v);
          current.lang = lang;
          current.last = out;
          if (out !== value) {
            if (attr) (node as Element).setAttribute(attr, out);
            else (node as Text).data = out;
          }
        };
        if (lang === from || fixed(original)) {
          write(original);
          return;
        }
        if (!groups.has(from)) groups.set(from, new Map());
        const group = groups.get(from)!;
        if (!group.has(original)) group.set(original, []);
        group.get(original)!.push(write);
      };
      const element = (el: Element) => {
        if (el.closest(skip)) return;
        for (const attr of attrs) if (el.hasAttribute(attr)) collect(el, attr);
      };
      for (const root of roots) {
        if (!root.isConnected) continue;
        if (root.nodeType === Node.TEXT_NODE) {
          collect(root, "");
          continue;
        }
        if (root.nodeType !== Node.ELEMENT_NODE || (root as Element).closest(skip)) continue;
        element(root as Element);
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
          acceptNode: (n) => (n.nodeType === Node.ELEMENT_NODE && (n as Element).matches(skip) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
        });
        let n: Node | null;
        while ((n = walker.nextNode())) {
          if (n.nodeType === Node.TEXT_NODE) collect(n, "");
          else element(n as Element);
        }
      }
      if (!groups.size) return;
      setPending((p) => p + 1);
      try {
        for (const [from, group] of groups) {
          const originals = [...group.keys()];
          const texts = await translateTexts(originals, lang, from);
          originals.forEach((s, i) => group.get(s)!.forEach((write) => write(texts[i]!)));
        }
      } catch (e) {
        if (live && (e as Error).name !== "AbortError") setFailed(true);
      } finally {
        setPending((p) => p - 1);
      }
    }

    const observer = new MutationObserver((changes) => {
      for (const m of changes) {
        if (m.type === "childList") m.addedNodes.forEach((n) => queue(n));
        else queue(m.target);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...attrs] });
    retry.current = () => {
      setFailed(false);
      queue(document.body);
    };
    queue(document.body);
    return () => {
      live = false;
      observer.disconnect();
      window.clearTimeout(timer);
      clearLanguageContent();
    };
  }, [lang]);

  if (lang === "es" || (!pending && !failed)) return null;
  return (
    <button type="button" className="language-progress" translate="no" aria-live="polite" onClick={() => retry.current()}>
      {(status[lang] ?? status.en!)[failed ? 1 : 0]}
    </button>
  );
}
