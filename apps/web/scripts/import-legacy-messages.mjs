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

// Same merge as legacy i18n.js: `{...kitchenTerms, ...workspacePickers, ...}`,
// later catalogs override earlier ones for the same Spanish source.
const legacyOrder = [
  'kitchen-terms', 'workspace-pickers', 'pdf-reader', 'workspace-costs', 'workspace-recipes', 'landing',
  'schedules', 'mail', 'staff', 'guide', 'guide-help', 'guide-assistant', 'auth', 'portal', 'document-brand',
  'workspace-shell', 'workspace-operations', 'workspace-plating',
];
const files = (await readdir(legacyLocales)).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3));
const unknown = files.filter(f => !legacyOrder.includes(f));
if (unknown.length) throw Error('Add these legacy catalogs to legacyOrder: ' + unknown.join(', '));
const catalog = new Map();
for (const file of legacyOrder) {
  const entries = (await import(pathToFileURL(join(legacyLocales, file + '.js')))).default;
  for (const [source, forms] of Object.entries(entries)) {
    if (Array.isArray(forms)) catalog.set(source, forms);
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
