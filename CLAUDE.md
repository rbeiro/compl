# CompI

Web portal for hotel kitchen teams (first client: Hotel Arts). Chefs and staff use it for:

- **Plating guides** (guías de emplatado): per hotel/outlet, downloadable as Word/PDF.
- **Recipe sheets** (fichas técnicas): ingredients, quantities, allergens, plating steps; draft → review → publish. An AI assistant helps write them.
- **Recipe costing**: tariffs, per-plate cost (the "plaza" cost engine).
- **Internal mail**: messages between colleagues, favorites, folders.
- **Schedules** (horarios): shift requests, approvals, balances.
- **Staff management**: invitations, roles/ranks (rank 1 = executive chef), access per hotel/outlet, account removal.
- **Auth**: email + password, two-step verification (MFA) for rank 1, forced password change on temporary passwords, personal recovery codes.

UI in 7 languages: es (source), en, ca, it, pt, fr, ar (right-to-left).

## Status: rewrite in progress

The original site (`legacy/`) is plain HTML/CSS/JS with hand-built routing, i18n, rendering and UI widgets. It is being rewritten as a TypeScript monorepo. Migrate **screen by screen**; the legacy code is the functional spec.

## Repository layout

```
apps/web/     New frontend: Next.js 16 (App Router), TypeScript, Tailwind v4, next-intl, @supabase/ssr
legacy/       Original static site (reference only). Has its own package.json and tests.
supabase/     Backend source we have: Edge Functions (Deno) + partial SQL for the Arts catalog
legacy/deployment/  Pending SQL proposals and test scripts from the previous owner (never applied)
```

Planned: `apps/api` (independent API, Hono + zod-openapi, for web and a future mobile app), `packages/shared` (zod schemas, domain logic such as the cost engine), `packages/db` (migrations + generated Supabase types).

## Backend (Supabase)

- Production project: `dzfwdxhbldnfqowrnhxf` (`chefi-laboratorio`). Most business logic lives in Postgres: `public.compi_*` RPCs (SECURITY DEFINER wrappers) calling `compi_private.*` functions, plus row-level security.
- **The repo does not contain the full schema.** RPCs for staff, mail, schedules, MFA and invitations are called by the frontend but not defined here. First backend task: `supabase db dump` into `supabase/migrations/` and set up a separate dev project.
- Edge Functions (`supabase/arts-edition/functions/`): document generation (pdf-lib, jszip), upload validation, rebranding, AI recipe assistant, account creation, invitation/recovery helpers.
- Legacy frontend calls Supabase REST/RPC directly via `fetch` (`legacy/public/portal.js`, see `api()`), with RPC names rewritten by `legacy/public/hotel-arts-api.js`.

## Commands (pnpm workspace, Node >= 22.12)

```bash
pnpm install
pnpm dev                                  # apps/web on :3000
pnpm build | pnpm lint | pnpm typecheck
pnpm --filter @compi/web messages:import  # regenerate translations from legacy catalogs
cd legacy && npm ci && npm test           # legacy build tests
```

## Conventions (apps/web)

- Next.js 16 differs from older versions: read `apps/web/node_modules/next/dist/docs/` before using an API you are unsure of. `middleware` is now `src/proxy.ts`; `params`/`cookies()` are async; Cache Components is on (request-time reads such as the session must sit inside `<Suspense>`); the locale comes from `next/root-params` (not available in Server Actions, so pass the locale explicitly or return error codes for the client to translate).
- Session reads go through `getCurrentUser()` in `src/lib/auth.ts` (uses `getClaims()`, never trust `getSession()` on the server).
- **Visual parity is a requirement**: ported screens must look and move exactly like the legacy ones. Copy values from the legacy CSS (`legacy/public/*.css`) as-is, including `clamp()` sizes, and check with `apps/web/scripts/parity/` (target: 0 differences at all widths, in `en` and `ar`).
- Styling: Tailwind with the brand tokens in `src/app/globals.css` (`text-green`, `bg-green-soft`, `text-muted`, `border-line`, `rounded-control`, `font-display`...) and the shared utilities `shell`, `home-wrap`, `kicker`, `btn-home`, `btn` + `btn-primary`, `alert-error`. Legacy breakpoints are max-width: use the `max-960` … `max-360` variants (their order in `globals.css` matters: widest first). Use logical properties (`ms-`, `pe-`, `start-`) for RTL unless the legacy CSS used a physical one.
- Motion: `carbon()` in `src/lib/motion.ts` is the legacy "carbon" preset (Web Animations API, respects reduced motion). Port other presets from `legacy/public/motion-choices.js` there when a screen needs them.
- Selects: Radix Select styled like the legacy menu (see `src/components/language-picker.tsx`).
- If a build serves stale CSS, delete `apps/web/.next` (Turbopack cache).
- Translations: add semantic keys to `apps/web/scripts/legacy-keys.mjs` mapped to the legacy Spanish source string, then run `messages:import`. Do not hand-edit `messages/*.json`.
- Mark unported legacy behavior with `TODO(port):`.

## Rules

- Never commit secrets (`.env*` is ignored except `.env.example`). The Supabase publishable key is public; the service-role key must never reach the client or Git.
- Do not point development at the production Supabase project: every write changes real hotel data.
- Do not run SQL, deploy Edge Functions or change DNS on production without explicit confirmation.
- Domains: `compichef.com` (primary); `.es`, `compikitchen.com/.es` to redirect. Registrar: IONOS. Production frontend is still the old host; the previous Cloudflare migration was never completed.
