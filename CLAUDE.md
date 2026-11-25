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
apps/web/     Frontend: Next.js 16 (App Router), TypeScript, Tailwind v4, next-intl; talks only to the API
apps/api/     API for web + future mobile: Hono, zod-openapi, pg + PgTyped (.sql files), Supabase Auth tokens
packages/api-client/  Typed API client generated from the OpenAPI spec (openapi-fetch), for web and mobile
legacy/       Original static site (reference only). Has its own package.json and tests.
supabase/     migrations/ (29, recovered from production history), inventory/remote_schema.sql
              (full current schema dump), arts-edition/ (Edge Functions + older SQL), config.toml
legacy/deployment/  Pending SQL proposals and test scripts from the previous owner (never applied)
```

Planned: `packages/shared` (domain logic such as the cost engine). Hosting: Vercel (web and API, two projects) + Supabase.

## Backend (Supabase)

- Production project: `dzfwdxhbldnfqowrnhxf` (`chefi-laboratorio`). Most business logic lives in Postgres: `public.compi_*` RPCs (SECURITY DEFINER wrappers) calling `compi_private.*` functions, plus row-level security.
- Schema in the repo: `supabase/migrations/` (production migration history) and `supabase/inventory/remote_schema.sql` (current dump of `public` + `compi_private`). Re-dump with `supabase db dump --remote -f supabase/inventory/remote_schema.sql` after schema changes; changes made outside migrations show up as a diff there.
- Supabase-specific dependencies of the schema are few (`auth.uid()/jwt()`, `auth.users`, `auth.sessions`, `storage.objects`, one Vault secret, roles): `apps/api/test/db/supabase-shim.sql` lists them and recreates them on plain Postgres.
- Edge Functions (`supabase/arts-edition/functions/`): document generation (pdf-lib, jszip), upload validation, rebranding, AI recipe assistant, account creation, invitation/recovery helpers.
- **API layer (`apps/api`)**: Supabase Auth issues tokens; the API verifies them and runs each request as the user in Postgres (`asUser`: role `authenticated` + `request.jwt.claims`), so the existing functions and RLS apply unchanged. Keep business rules in SQL functions; queries are `.sql` files in `apps/api/src/queries/` compiled by PgTyped into typed `*.queries.ts` (run `db:gen` after editing; no supabase-js/PostgREST on the server) so the database stays portable. Tests run against the production schema on a local Postgres. See `apps/api/README.md`.
- **Web → API**: the web app never talks to Supabase. Sign-in, refresh, two-step codes, recovery and invitations go through `/v1/auth/*`; the tokens live in httpOnly cookies (`src/lib/session*.ts`, refreshed in `src/proxy.ts`); all data goes through the typed client (`apps/web/src/lib/api.ts`).
- **Auth provider**: Supabase Auth by default, behind `AuthProvider` (`apps/api/src/auth/provider.ts`, adapter `supabase-provider.ts`). Two-step verification is a 6-digit code emailed with Resend, issued/checked in Postgres (`compi_private.second_factor_*`). After an API change, run `pnpm --filter @compi/api openapi:export` to update `packages/api-client`.
- Legacy frontend calls Supabase REST/RPC directly via `fetch` (`legacy/public/portal.js`, see `api()`), with RPC names rewritten by `legacy/public/hotel-arts-api.js`.

## Commands (pnpm workspace, Node >= 22.12)

```bash
pnpm install
pnpm dev                                  # apps/web on :3000
pnpm dev:api                              # apps/api on :8787 (docs at /docs)
pnpm build | pnpm lint | pnpm typecheck | pnpm test
pnpm clean                                # delete build caches (fixes stale CSS)
pnpm --filter @compi/api db:local         # local Postgres DB: production schema + demo users and guide files
pnpm --filter @compi/api db:gen           # regenerate typed queries from src/queries/*.sql
pnpm --filter @compi/api dev:auth         # local fake Supabase Auth (dev only) — see apps/api/README.md
pnpm --filter @compi/api openapi:export   # update packages/api-client from the API spec
pnpm --filter @compi/web messages:import  # regenerate translations from legacy catalogs
cd legacy && npm ci && npm test           # legacy build tests
```

## Conventions (apps/web)

- Next.js 16 differs from older versions: read `apps/web/node_modules/next/dist/docs/` before using an API you are unsure of. `middleware` is now `src/proxy.ts`; `params`/`cookies()` are async; Cache Components is on (request-time reads such as the session must sit inside `<Suspense>`); the locale comes from `next/root-params` (not available in Server Actions, so pass the locale explicitly or return error codes for the client to translate).
- Data and session checks go through the API (`getApi()`, `sessionDestination()` in `src/lib/api.ts`); never decode tokens to make authorization decisions in the web app.
- **Visual parity is a requirement**: ported screens must look and move exactly like the legacy ones. Copy values from the legacy CSS (`legacy/public/*.css`) as-is, including `clamp()` sizes, and check with `apps/web/scripts/parity/` (target: 0 differences at all widths, in `en` and `ar`).
- Styling: Tailwind with the brand tokens in `src/app/globals.css` (`text-green`, `bg-green-soft`, `text-muted`, `border-line`, `rounded-control`, `font-display`...) and the shared utilities `shell`, `home-wrap`, `kicker`, `btn-home`, `btn` + `btn-primary`, `alert-error`. Legacy breakpoints are max-width: use the `max-960` … `max-360` variants (their order in `globals.css` matters: widest first). Use logical properties (`ms-`, `pe-`, `start-`) for RTL unless the legacy CSS used a physical one.
- Screens with large, self-contained legacy stylesheets (e.g. Plating Guides) use a CSS Module next to the component, copied from the legacy CSS with its class names (scope class → `.root`); components add the legacy class names unhashed too (helper `cx`) so parity selectors match. Shell, auth and simple screens use Tailwind.
- Files and images: the browser loads them from `/api/guides/...` (route handler that adds the session token and forwards allow-listed paths to the API).
- Motion: `carbon()` in `src/lib/motion.ts` is the legacy "carbon" preset; `sequence()` is "secuencia", `duo()` is "duo" (Web Animations API, respect reduced motion). Port other presets from `legacy/public/motion-choices.js` there when a screen needs them.
- Selects: Radix Select styled like the legacy menu (see `src/components/language-picker.tsx`).
- If a build serves stale CSS, delete `apps/web/.next` (Turbopack cache).
- Translations: add semantic keys to `apps/web/scripts/legacy-keys.mjs` mapped to the legacy Spanish source string; strings that never existed in legacy go to `scripts/new-messages.mjs` with all 7 languages. Then run `messages:import`. Do not hand-edit `messages/*.json`.
- Mark unported legacy behavior with `TODO(port):`.

## Rules

- Never commit secrets (`.env*` is ignored except `.env.example`). The Supabase publishable key is public; the service-role key must never reach the client or Git.
- Do not point development at the production Supabase project: every write changes real hotel data.
- Do not run SQL, deploy Edge Functions or change DNS on production without explicit confirmation.
- Domains: `compichef.com` (primary); `.es`, `compikitchen.com/.es` to redirect. Registrar: IONOS. Production frontend is still the old host; the previous Cloudflare migration was never completed.
