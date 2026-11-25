// Builds messages/<locale>.json from the legacy catalogs.
// Legacy format: { 'Spanish source': [en, ca, it, pt, fr, ar] } spread over many files.
import {readdir, writeFile} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {dirname, join} from 'node:path';
import keys from './legacy-keys.mjs';
import newMessages from './new-messages.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const legacyLocales = join(here, '../../../legacy/public/locales');
const messagesDir = join(here, '../messages');
const columns = ['en', 'ca', 'it', 'pt', 'fr', 'ar'];

const catalog = new Map();
for (const file of (await readdir(legacyLocales)).filter(f => f.endsWith('.js')).sort()) {
  const entries = (await import(pathToFileURL(join(legacyLocales, file)))).default;
  for (const [source, forms] of Object.entries(entries)) {
    if (!catalog.has(source) && Array.isArray(forms)) catalog.set(source, forms);
  }
}

// Strings that live in legacy JS code but not in locales/*.js (e.g. login errors in portal.js).
const missing = [];
const output = Object.fromEntries(['es', ...columns].map(l => [l, {}]));
for (const [namespace, entries] of Object.entries(keys)) {
  for (const l of Object.keys(output)) output[l][namespace] = {};
  for (const [key, source] of Object.entries(entries)) {
    const forms = catalog.get(source);
    if (!forms) missing.push(`${namespace}.${key}`);
    output.es[namespace][key] = source;
    columns.forEach((l, i) => { output[l][namespace][key] = forms?.[i] || source; });
  }
}

// New strings (no legacy source) come with their own translations.
for (const [namespace, entries] of Object.entries(newMessages)) {
  for (const [key, forms] of Object.entries(entries)) {
    for (const l of Object.keys(output)) {
      output[l][namespace] ??= {};
      if (output[l][namespace][key] !== undefined) throw Error(`${namespace}.${key} is defined twice`);
      output[l][namespace][key] = forms[l];
    }
  }
}

for (const [locale, messages] of Object.entries(output)) {
  await writeFile(join(messagesDir, locale + '.json'), JSON.stringify(messages, null, 2) + '\n');
}
console.log(`Wrote ${Object.keys(output).length} catalogs.`);
if (missing.length) console.warn('No legacy translation (Spanish used as fallback):\n  ' + missing.join('\n  '));
