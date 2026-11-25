// Visual parity check: legacy site (http://127.0.0.1:4173) vs new app (http://127.0.0.1:4300).
// See scripts/parity/README.md.
import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)('playwright');
const [,, lang = 'en', widths = '1280,900,700,390'] = process.argv;
const L = 'http://127.0.0.1:4173', N = 'http://127.0.0.1:4300';
const pages = {
  landing: { legacy: `${L}/`, next: `${N}/${lang}`, wait: '#home-title', pairs: {
    header: ['.masthead', 'header'], logo: ['.masthead .brand img', 'header img'],
    navAbout: ['.public-nav > a:nth-child(1)', 'header nav a:nth-of-type(1)'],
    signIn: ['.header-access', 'header nav a:last-child'], picker: ['[data-language-picker]', 'header [role=combobox]'],
    pickerName: ['.language-name', 'header [role=combobox] span[lang]'],
    kicker: ['.hero-copy .home-kicker', '#home-title ~ p, main section:first-child .kicker'],
    h1: ['#home-title', '#home-title'], lead: ['.hero-lead', '#home-title + p'],
    cta: ['.hero-actions .home-button', '#home-title ~ div a:first-child'], textLink: ['.home-text-link', '#home-title ~ div a:last-child'],
    heroPhoto: ['.hero-photo', 'main section:first-child figure'],
    projKicker: ['#proyecto .home-kicker', '#proyecto .kicker'], projH2: ['#project-title', '#project-title'],
    projP: ['.project-copy p', '#proyecto > div:last-child p'], toolsSection: ['.home-tools', '#herramientas'],
    toolsPhoto: ['.tools-photo', '#herramientas figure'], toolsH2: ['#tools-title', '#tools-title'],
    summary: ['.tools-copy summary', '#herramientas summary'], detailsP: ['.tools-copy details p', '#herramientas details p'],
    lastDetails: ['.tools-copy details:last-of-type', '#herramientas details:last-of-type'],
    footer: ['.home-footer', 'footer'], footLogo: ['.foot-inner img', 'footer img'], footNote: ['.foot-inner > span', 'footer span'],
    footAccess: ['.foot-access', 'footer a:last-child'],
  }},
  login: { legacy: `${L}/#/acceso`, next: `${N}/${lang}/acceso`, wait: 'input[name=email]', pairs: {
    header: ['.masthead', 'header'], logo: ['.masthead .brand img', 'header img'],
    signIn: ['.header-access', 'header nav a:last-child'], picker: ['[data-language-picker]', 'header [role=combobox]'],
    h1: ['.auth-content h1', 'main h1'], intro: ['.auth-content .intro', 'main h1 + p'],
    emailLabel: ['#login label', 'form label'], email: ['input[name=email]', 'input[name=email]'],
    emailIcon: ['#login .input-wrap .icon', 'form label svg'], password: ['input[name=password]', 'input[name=password]'],
    submit: ['#login button', 'form button'], forgot: ['.auth-content #login + a', 'main form + a'],
    photo: ['.auth-photo', 'main div[aria-hidden]'],
  }},
  recover: { legacy: `${L}/#/recuperar`, next: `${N}/${lang}/recuperar`, wait: 'input[name=password], input[type=password]', pairs: {
    header: ['.masthead', 'header'], h1: ['.auth-content h1', 'main h1'], intro: ['.auth-content .intro', 'main h1 + p'],
    emailLabel: ['.recovery-view label', 'main form label'], email: ['.recovery-view input[type=email]', 'input[name=email]'],
    code: ['.recovery-view label:nth-of-type(2) input', 'input[name=code]'],
    password: ['.recovery-view label:nth-of-type(3) input', 'input[name=password]'],
    submit: ['.recovery-view form button', 'main form button'], back: ['.recovery-view > a', 'main form ~ a'],
  }},
  invitation: { legacy: `${L}/invitacion.html`, next: `${N}/${lang}/invitacion`, wait: '#intro', pairs: {
    header: ['.masthead', 'header'], logo: ['.masthead .brand img', 'header img'], lab: ['.lab-context', 'header span.ml-auto'], h1: ['.auth-content h1', 'main h1'],
    intro: ['#intro', '#intro'], back: ['#back', 'main h1 ~ a'], photo: ['.auth-photo', 'main div[aria-hidden]'],
  }},
};
const props = ['fontSize','fontFamily','fontWeight','color','backgroundColor','letterSpacing','lineHeight','borderTopColor','borderTopWidth','borderRadius','textDecorationLine','paddingLeft','paddingTop'];
async function measure(page, url, wait, sels) {
  await page.goto(url); await page.waitForSelector(wait); await page.waitForTimeout(1200);
  // Scroll through to trigger reveals/lazy images, then back to top.
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { scrollTo(0, y); await new Promise(r => setTimeout(r, 40)); } scrollTo(0, 0); });
  await page.waitForTimeout(600);
  return page.evaluate(([sels, props]) => Object.fromEntries(Object.entries(sels).map(([k, s]) => {
    const el = document.querySelector(s); if (!el) return [k, null];
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return [k, { x: r.x, y: r.y + scrollY, w: r.width, h: r.height, ...Object.fromEntries(props.map(p => [p, p === 'fontFamily' ? cs[p].split(',')[0].replace(/"/g,'') : cs[p]])) }];
  })), [sels, props]);
}
const b = await chromium.launch(); let total = 0;
for (const w of widths.split(',').map(Number)) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, locale: lang === 'ar' ? 'ar' : 'en-US' });
  const page = await ctx.newPage();
  for (const [name, cfg] of Object.entries(pages)) {
    const legacySel = Object.fromEntries(Object.entries(cfg.pairs).map(([k, v]) => [k, v[0]]));
    const nextSel = Object.fromEntries(Object.entries(cfg.pairs).map(([k, v]) => [k, v[1]]));
    const a = await measure(page, cfg.legacy, cfg.wait, legacySel);
    const n = await measure(page, cfg.next, cfg.wait, nextSel);
    const out = [];
    for (const k of Object.keys(cfg.pairs)) {
      if (!a[k] || !n[k]) { out.push(`  ${k}: missing ${!a[k] ? 'legacy' : 'next'}`); continue; }
      const d = [];
      for (const g of ['x','y','w','h']) if (Math.abs(a[k][g] - n[k][g]) > 1) d.push(`${g} ${a[k][g].toFixed(1)}→${n[k][g].toFixed(1)}`);
      for (const p of props) if (a[k][p] !== n[k][p] && !(p === 'borderTopColor' && a[k].borderTopWidth === '0px' && n[k].borderTopWidth === '0px')) d.push(`${p} ${a[k][p]}→${n[k][p]}`);
      if (d.length) out.push(`  ${k}: ${d.join(' | ')}`);
    }
    total += out.length;
    console.log(`[${w}px ${name}] ${out.length ? out.length + ' differences' : 'match'}`); out.forEach(l => console.log(l));
  }
  await ctx.close();
}
await b.close(); console.log('TOTAL', total);
