// Visual parity check: legacy site (http://127.0.0.1:4173) vs new app (http://127.0.0.1:4300).
// See scripts/parity/README.md.
import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)('playwright');
const out = process.argv[2];
const L = 'http://127.0.0.1:4173', N = 'http://127.0.0.1:4300/en';
const S = {
  legacy: { cta: '.hero-actions .home-button', nav: '.public-nav > a:nth-child(1)', signIn: '.header-access', picker: '[data-language-picker]',
    textLink: '.home-text-link', footAccess: '.foot-access', summary2: '.tools-copy details:nth-of-type(2) summary', tools: '.tools-copy',
    details: '.tools-copy details', submit: '#login button', error: '#login [role=alert]', auth: '.auth-content', proyectoH2: '#project-title' },
  next: { cta: '#home-title ~ div a:first-child', nav: 'header nav a:nth-of-type(1)', signIn: 'header nav a:last-child', picker: 'header [role=combobox]',
    textLink: '#home-title ~ div a:last-child', footAccess: 'footer a:last-child', summary2: '#herramientas details:nth-of-type(2) summary', tools: '[data-tools]',
    details: '#herramientas details', submit: 'form button', error: 'form [role=alert]', auth: 'main h1', proyectoH2: '#project-title' },
};
const P = ['color','backgroundColor','textDecorationLine','textUnderlineOffset','boxShadow','outlineStyle','outlineWidth','outlineOffset','outlineColor','borderTopColor'];
const style = (page, sel) => page.$eval(sel, (el, P) => { const c = getComputedStyle(el); const svg = el.querySelector('svg'); return {...Object.fromEntries(P.map(p => [p, c[p]])), svgTranslate: svg ? getComputedStyle(svg).translate : null}; }, P);
const anims = (page) => page.evaluate(() => document.getAnimations().map(a => {
  const e = a.effect, t = e.getTiming(); const kf = e.getKeyframes?.() || [];
  return { name: a.animationName || 'waapi', target: e.target.id || e.target.tagName, duration: Math.round(t.duration), delay: t.delay, easing: t.easing, frames: kf.map(f => ({ o: f.opacity, tr: f.translate || f.transform })) };
}).filter(a => a.name === 'waapi' || a.name === 'home-enter'));
const result = {};
const b = await chromium.launch();
for (const side of ['legacy', 'next']) {
  const s = S[side], r = result[side] = {};
  const page = await b.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US', deviceScaleFactor: 1 });
  await page.route('**/supabase.co/**', route => route.abort()); // never reach production
  await page.goto(side === 'legacy' ? L + '/' : N); await page.waitForTimeout(100);
  r.enterAnims = await anims(page);
  await page.waitForTimeout(1200);
  for (const k of ['cta', 'nav', 'signIn', 'picker', 'textLink', 'footAccess']) {
    await page.hover(s[k]); await page.waitForTimeout(350); r['hover:' + k] = await style(page, s[k]);
  }
  await page.mouse.move(5, 5); await page.waitForTimeout(300);
  // Keyboard focus ring on the first CTA.
  await page.focus(s.cta); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab'); await page.waitForTimeout(200);
  r['focus:cta'] = await style(page, s.cta);
  // Accordion: open the 2nd item (exclusive group closes the 1st).
  await page.locator(s.tools).scrollIntoViewIfNeeded(); await page.waitForTimeout(800);
  await page.click(s.summary2); await page.waitForTimeout(20);
  r.toggleAnims = await anims(page);
  await page.waitForTimeout(400);
  r.openStates = await page.$$eval(s.details, ds => ds.map(d => d.open));
  await page.locator(s.tools).screenshot({ path: `${out}/${side}-tools.png` });
  // Section jump.
  await page.evaluate(() => scrollTo(0, 0)); await page.click(s.nav); await page.waitForTimeout(30);
  r.jumpAnims = await anims(page);
  await page.waitForTimeout(500);
  // Language menu.
  await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(300);
  await page.click(s.picker); await page.waitForTimeout(30);
  r.menuAnims = await anims(page); await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${side}-menu.png`, clip: { x: 880, y: 0, width: 400, height: 520 } });
  await page.keyboard.press('Escape');
  // Sign-in: entrance + failed sign-in feedback.
  await page.goto(side === 'legacy' ? L + '/#/acceso' : N + '/acceso'); await page.waitForTimeout(20);
  r.authAnims = await anims(page);
  await page.waitForSelector('input[name=email]'); await page.waitForTimeout(800);
  await page.click(s.submit); await page.waitForTimeout(30);
  r.invalidAnims = await anims(page);
  await page.fill('input[name=email]', 'someone@example.com'); await page.fill('input[name=password]', 'x');
  await page.click(s.submit);
  await page.waitForFunction(sel => document.querySelector(sel)?.textContent.trim(), s.error, { timeout: 10000 });
  r.errorAnims = await anims(page);
  r.errorText = await page.textContent(s.error);
  await page.waitForTimeout(400);
  await page.locator('main').screenshot({ path: `${out}/${side}-login-error.png` });
  await page.close();
}
await b.close();
const diff = (a, n, path = '') => {
  if (JSON.stringify(a) === JSON.stringify(n)) return [];
  if (a && n && typeof a === 'object' && typeof n === 'object' && !Array.isArray(a)) return Object.keys({...a, ...n}).flatMap(k => diff(a[k], n[k], path + '.' + k));
  return [`${path}: ${JSON.stringify(a)}  →  ${JSON.stringify(n)}`];
};
for (const k of Object.keys(result.legacy)) {
  const d = diff(result.legacy[k], result.next[k], k);
  console.log(d.length ? d.join('\n') : `${k}: match`);
}
