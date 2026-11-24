# Visual parity checks

Compares the new app against the legacy site while screens are being ported.
Both servers must be running:

```bash
cd legacy && npm run build && (cd dist && python3 -m http.server 4173 --bind 127.0.0.1)
pnpm --filter @compi/web build && pnpm --filter @compi/web start -p 4300
```

- `compare.mjs [lang] [widths]` — position, size and typography of key elements on
  each page at each width; prints every difference over 1px. Example:
  `node scripts/parity/compare.mjs en 1280,900,700,390`. Target: `TOTAL 0`.
- `states.mjs <outDir>` — hover/focus styles, accordion, language menu, sign-in error
  and the Web Animations (keyframes, duration, easing) of both sites; writes
  screenshots to `outDir`. Sign-in requests to Supabase are blocked in the browser.

Requires Playwright (`require('playwright')`). Add selector pairs for each newly
ported screen.
