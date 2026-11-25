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

## Signed-in screens

The legacy portal only talks to Supabase, so `apps/api/dev/legacy-backend.ts`
stands in for it locally: a fake Supabase Auth plus the slice of PostgREST the
legacy code uses (RPCs and simple selects, run as the user). Playwright reroutes
the legacy page's calls to the production URL to it, so production is never
contacted. Both sites then read the same local database (`db:local` seed).

```bash
pnpm --filter @compi/api db:local
pnpm --filter @compi/api dev:legacy-backend          # :9998, for the legacy site
pnpm --filter @compi/api dev:auth                    # :9999, for the new stack
# API (:8787) with SUPABASE_URL=http://127.0.0.1:9999, emails logged to a file
API_LOG=/path/to/api.log node scripts/parity/compare-signed-in.mjs home en 1440,960,390
```

- `session.mjs` — sign-in helpers for both sites (reads two-step codes from the API log).
- `compare-signed-in.mjs` — same idea as `compare.mjs`, but the new markup carries
  the legacy class names as unstyled marker classes (`ws-rail`, `ws-metric`...),
  so each screen lists one selector per element for both sites.
