import kitchenTerms from './locales/kitchen-terms.js';
import {motionFor} from './motion-choices.js';
import workspacePickers from './locales/workspace-pickers.js';
import pdfReader from './locales/pdf-reader.js';
import workspacePlating from './locales/workspace-plating.js';
import workspaceShell from './locales/workspace-shell.js';
import workspaceOperations from './locales/workspace-operations.js';
import workspaceCosts from './locales/workspace-costs.js';
import workspaceRecipes from './locales/workspace-recipes.js';
import documentBrand from './locales/document-brand.js';
import portal from './locales/portal.js';
import landing from './locales/landing.js';
import schedules from './locales/schedules.js';
import mail from './locales/mail.js';
import staff from './locales/staff.js';
import guide from './locales/guide.js';
import guideHelp from './locales/guide-help.js';
import guideAssistant from './locales/guide-assistant.js';
import auth from './locales/auth.js';

const languages = {
  es: 'Español', it: 'Italiano', en: 'English', ca: 'Català',
  pt: 'Português', fr: 'Français', ar: 'العربية'
};
const columns = ['en', 'ca', 'it', 'pt', 'fr', 'ar'];
const messages = new Map(Object.entries({...kitchenTerms, ...workspacePickers, ...pdfReader, ...workspaceCosts, ...workspaceRecipes, ...landing, ...schedules, ...mail, ...staff, ...guide, ...guideHelp, ...guideAssistant, ...auth, ...portal, ...documentBrand, ...workspaceShell, ...workspaceOperations, ...workspacePlating}));
const preferenceKey = 'compi.language';
const bindings = new WeakMap();
const pickers = new WeakMap();

export function deviceLanguage(choices) {
  for (const tag of choices) {
    if (typeof tag !== 'string') continue;
    const language = tag.toLowerCase().split(/[-_]/)[0];
    if (Object.hasOwn(languages, language)) return language;
  }
  return 'es';
}
function savedPreference() {
  try {
    const saved = localStorage.getItem(preferenceKey);
    return Object.hasOwn(languages, saved) ? saved : 'auto';
  } catch { return 'auto'; }
}
function resolve(preference) {
  if (preference !== 'auto') return preference;
  return deviceLanguage([...(navigator.languages || []), navigator.language]);
}
let preference = savedPreference();
let current = resolve(preference);
export function locale() { return current; }
export function t(source, params = {}) {
  if (typeof params === 'function') params = params();
  const raw = messages.get(source)?.[columns.indexOf(current)] ?? source;
  const answer=raw.replace(/\{(\w+)\}/g, (token, key) => Object.hasOwn(params, key) ? String(params[key]) : token);
  if(current!=='es' && messages.has(source)){isLocalized('',current);rendered.get(current).add(answer);if(Object.keys(params).length)sourceForms.set(answer,source.replace(/\{(\w+)\}/g,(token,k)=>Object.hasOwn(params,k)?String(params[k]):token));}
  return answer;
}

const rendered=new Map(), sourceForms=new Map();
for(const [source,forms] of messages)for(const form of forms)if(form&&!sourceForms.has(form))sourceForms.set(form,source);
export function canonicalText(value){return messages.has(value)?value:sourceForms.get(value)||value;}
export function lookupTranslation(source,lang){
  return lang==='es'?source:(messages.get(source)?.[columns.indexOf(lang)]??null);
}
export function isLocalized(text,lang){
  if(!rendered.has(lang))rendered.set(lang,new Set([...messages.values()].map(v=>v[columns.indexOf(lang)]).filter(Boolean)));
  return rendered.get(lang).has(text);
}
function stateFor(element) {
  let record = bindings.get(element);
  if (!record) {
    record = {attributes: new Map()};
    bindings.set(element, record);
    element.setAttribute('data-compi-live', '');
  }
  return record;
}
function updateText(element, format) {
  const record = stateFor(element);
  let text = record.node;
  if (!text || text.parentNode !== element) {
    text = Array.from(element.childNodes).find(child => child.nodeType === 3 && child.data.trim());
    if (!text) {
      text = document.createTextNode('');
      element.prepend(text);
    }
    record.node = text;
  }
  record.format = format;
  text.data = format ? format() : '';
  return element;
}
export function bindText(element, source, params = {}) {
  element.removeAttribute('data-i18n');
  return updateText(element, source ? () => t(source, params) : null);
}
export function bindComputed(element, format) {
  element.removeAttribute('data-i18n');
  return updateText(element, format);
}
export function bindAttr(element, attr, source, params = {}) {
  const format = () => t(source, params);
  stateFor(element).attributes.set(attr, format);
  element.setAttribute(attr, format());
  return element;
}

function matching(root, selector) {
  const children = [...root.querySelectorAll(selector)];
  if (root.matches?.(selector)) children.unshift(root);
  return children;
}
// Static attributes keep the Spanish source when a translated template is cloned.
export function localize(root = document) {
  for (const el of matching(root, '[data-i18n]')) {
    const value = t(el.getAttribute('data-i18n'));
    if (el.textContent !== value) el.textContent = value;
  }
  for (const el of matching(root, '[data-i18n-attr]')) {
    for (const name of el.getAttribute('data-i18n-attr').split(/\s+/).filter(Boolean)) {
      const original = 'data-i18n-original-' + name;
      if (!el.hasAttribute(original)) el.setAttribute(original, el.getAttribute(name) || '');
      el.setAttribute(name, t(el.getAttribute(original)));
    }
  }
  for (const el of matching(root, '[data-compi-live]')) {
    const record = bindings.get(el);
    if (!record) continue;
    if (record.format && record.node?.parentNode === el) record.node.data = record.format();
    for (const [name, format] of record.attributes) el.setAttribute(name, format());
  }
  for (const host of matching(root, '[data-language-picker]')) updatePicker(host);
}

function updatePicker(host) {
  let picker = pickers.get(host);
  if (!picker) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const globe = document.createElementNS(svgNS, 'svg');
    globe.setAttribute('viewBox', '0 0 24 24');
    globe.setAttribute('aria-hidden', 'true');
    globe.classList.add('language-globe');
    for (const [tag, attrs] of [
      ['circle', {cx:12, cy:12, r:9}],
      ['ellipse', {cx:12, cy:12, rx:4, ry:9}],
      ['path', {d:'M3 12h18'}]
    ]) {
      const shape = document.createElementNS(svgNS, tag);
      for (const [key, value] of Object.entries(attrs)) shape.setAttribute(key, value);
      globe.append(shape);
    }
    const name = document.createElement('span');
    name.className = 'language-name';
    name.setAttribute('aria-hidden', 'true');
    const select = document.createElement('select');
    const auto = document.createElement('option');
    auto.value = 'auto';
    select.append(auto);
    for (const [code, label] of Object.entries(languages)) {
      const option = document.createElement('option');
      option.value = code;
      option.lang = code;
      option.dir = code === 'ar' ? 'rtl' : 'ltr';
      option.textContent = label;
      select.append(option);
    }
    select.addEventListener('change', () => {
      choose(select.value);
      motionFor('language',name);
    });
    host.append(globe, name, select);
    picker = {name, select, auto};
    pickers.set(host, picker);
  }
  picker.auto.textContent = t('Usar el idioma del dispositivo');
  picker.select.setAttribute('aria-label', t('Seleccionar idioma'));
  picker.select.title = t('Seleccionar idioma');
  picker.select.value = preference;
  picker.name.textContent = languages[current];
  picker.name.lang = current;
}
function applyPreference(next) {
  const previous = current;
  preference = next;
  current = resolve(next);
  document.documentElement.lang = current;
  document.documentElement.dir = current === 'ar' ? 'rtl' : 'ltr';
  localize();
  if (previous !== current) {
    window.dispatchEvent(new CustomEvent('compi:languagechange', {detail:{locale:current, previous}}));
  }
}
function choose(next) {
  if (next !== 'auto' && !Object.hasOwn(languages, next)) return;
  try {
    if (next === 'auto') localStorage.removeItem(preferenceKey);
    else localStorage.setItem(preferenceKey, next);
  } catch { /* The choice still applies in this tab. */ }
  applyPreference(next);
}
window.addEventListener('languagechange', () => { if (preference === 'auto') applyPreference('auto'); });
window.addEventListener('storage', event => {
  if (event.key === preferenceKey || event.key === null) applyPreference(savedPreference());
});
applyPreference(preference);

if(typeof Worker!=='undefined')import('./content-language.js').then(m=>m.observeContent());
