// Signed-in parity: same selectors on legacy (marker classes = legacy classes) and new.
import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)('playwright');
import { legacyContext, legacySignIn, newSignIn, L, N } from './session.mjs';
// Usage: API_LOG=<api log> node compare-signed-in.mjs <screen> <lang> <widths> [email]
const [,, screen = 'home', lang = 'en', widths = '1440,1190,960,760,580,390', email = 'cocinero@compichef.com'] = process.argv;
const screens = {
  home: { legacy: '#/portal', next: '/portal', wait: '.ws-metric', sels: [
    '.masthead', '.ws-top-context', '.ws-hotel-copy strong', '.ws-crumb', '#logout', '[data-language-picker]', '.ws-menu-toggle',
    '.ws-rail', '.ws-rail-head', '.ws-rail-label', '.ws-nav .ws-nav-link', '.ws-nav .ws-nav-link:nth-child(2)', '.ws-nav .ws-nav-link:nth-child(7)', '.ws-support', '.ws-support .ws-nav-link',
    '.ws-main-content', '.ws-today', '.ws-intro h1', '.ws-intro p', '.ws-welcome-actions a', '.ws-welcome-actions a:nth-child(2)', '.ws-hotel-card', '.ws-hotel-card h2',
    '.ws-metrics', '.ws-metric', '.ws-metric-top', '.ws-metric strong', '.ws-metric:nth-child(3)', '.ws-metric:nth-child(4)', '.ws-panels', '.ws-panel', '.ws-panel h2', '.ws-guide-link',
    '.ws-guide-link strong', '.ws-panel:nth-child(2)', '.ws-state-row', '.ws-state-row dd',
  ]},
};
const props = ['fontSize','fontFamily','fontWeight','color','backgroundColor','letterSpacing','lineHeight','borderTopColor','borderTopWidth','borderRadius','paddingLeft','paddingTop'];
const cfg = screens[screen];
async function measure(page) {
  await page.waitForSelector(cfg.wait); await page.waitForTimeout(900);
  return page.evaluate(([sels, props]) => Object.fromEntries(sels.map((s) => {
    const el = document.querySelector(s); if (!el) return [s, null];
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return [s, 'hidden'];
    return [s, { x: r.x, y: r.y + scrollY, w: r.width, h: r.height, ...Object.fromEntries(props.map(p => [p, p === 'fontFamily' ? cs[p].split(',')[0].replace(/"/g,'') : cs[p]])) }];
  })), [cfg.sels, props]);
}
const b = await chromium.launch(); let total = 0;
const opts = (w) => ({ viewport: { width: w, height: 900 }, locale: lang === 'ar' ? 'ar' : 'en-US' });
for (const w of widths.split(',').map(Number)) {
  const lc = await legacyContext(b, opts(w)); const lp = await lc.newPage();
  await legacySignIn(lp, email);
  if (lang !== 'en' || true) { await lp.evaluate((l) => localStorage.setItem('compi.language', l), lang); }
  await lp.goto(L + '/' + cfg.legacy); await lp.reload();
  const a = await measure(lp);
  const nc = await b.newContext(opts(w)); const np = await nc.newPage();
  await newSignIn(np, email, { lang, log: process.env.API_LOG });
  await np.goto(`${N}/${lang}${cfg.next}`);
  const n = await measure(np);
  const out = [];
  for (const k of cfg.sels) {
    if (a[k] === 'hidden' && n[k] === 'hidden') continue;
    if (!a[k] || !n[k] || typeof a[k] === 'string' || typeof n[k] === 'string') { if (a[k] !== n[k] && !(a[k] == null && n[k] == null)) out.push(`  ${k}: legacy=${JSON.stringify(a[k] && typeof a[k]==='object' ? 'shown' : a[k])} next=${JSON.stringify(n[k] && typeof n[k]==='object' ? 'shown' : n[k])}`); continue; }
    const d = [];
    for (const g of ['x','y','w','h']) if (Math.abs(a[k][g] - n[k][g]) > 1) d.push(`${g} ${a[k][g].toFixed(1)}→${n[k][g].toFixed(1)}`);
    for (const p of props) if (a[k][p] !== n[k][p] && !(p === 'borderTopColor' && a[k].borderTopWidth === '0px' && n[k].borderTopWidth === '0px')) d.push(`${p} ${a[k][p]}→${n[k][p]}`);
    if (d.length) out.push(`  ${k}: ${d.join(' | ')}`);
  }
  total += out.length; console.log(`[${w}px ${screen} ${lang}] ${out.length ? out.length + ' differences' : 'match'}`); out.forEach(l => console.log(l));
  await lc.close(); await nc.close();
}
await b.close(); console.log('TOTAL', total);
