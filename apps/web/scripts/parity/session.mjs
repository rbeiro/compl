// Shared helpers: signed-in sessions on the legacy site (via the local legacy
// backend stand-in) and on the new app (via its own sign-in form).
import { readFileSync } from 'node:fs';
export const L = 'http://127.0.0.1:4173', N = 'http://127.0.0.1:4300';
const PROD = 'https://dzfwdxhbldnfqowrnhxf.supabase.co';
export async function legacyContext(browser, opts) {
  const ctx = await browser.newContext(opts);
  await ctx.route(PROD + '/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const res = await route.fetch({ url: req.url().replace(PROD, 'http://127.0.0.1:9998') });
    await route.fulfill({ response: res, headers: { ...res.headers(), 'access-control-allow-origin': '*' } });
  });
  return ctx;
}
export async function legacySignIn(page, email, password = 'compi-dev') {
  await page.goto(L + '/#/acceso'); await page.waitForSelector('#login button:not([disabled])');
  await page.fill('input[name=email]', email); await page.fill('input[name=password]', password);
  await page.click('#login button'); await page.waitForSelector('.ws-frame', { timeout: 15000 });
}
export async function newSignIn(page, email, { lang = 'en', password = 'compi-dev', log } = {}) {
  await page.goto(`${N}/${lang}/acceso`); await page.waitForSelector('form button:not([disabled])');
  await page.fill('input[name=email]', email); await page.fill('input[name=password]', password); await page.click('form button');
  await page.waitForURL((u) => !u.pathname.endsWith('/acceso'), { timeout: 15000 });
  if (page.url().includes('/verificacion')) {
    const text = readFileSync(log, 'utf8'); const i = text.lastIndexOf(`[email] to: ${email}`);
    await page.fill('input[name=code]', text.slice(i).match(/\b(\d{6})\b/)[1]);
    await page.click('form button[type=submit] >> nth=0'); await page.waitForURL('**/portal');
  }
}
