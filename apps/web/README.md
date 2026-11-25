# @compi/web

Next.js (App Router) frontend for CompI. See the root `CLAUDE.md` for the
project overview.

```bash
cp .env.example .env.local   # dev Supabase project (or the local fake auth) + API_URL
pnpm dev                     # http://localhost:3000
pnpm build && pnpm start
pnpm typecheck && pnpm lint
pnpm messages:import         # regenerate messages/*.json from the legacy catalogs
```

## Layout

- `src/app/[locale]/` — routes. `/` is Spanish, other languages are prefixed (`/en`, `/ar`).
- `src/app/actions/` — Server Actions (sign in / sign out).
- `src/i18n/` — next-intl routing, request config and locale-aware navigation.
- `src/lib/supabase/` — Supabase clients (server + proxy session refresh). Supabase is
  used for authentication only; data comes from the API.
- `src/lib/api.ts` — typed API client (`@compi/api-client`) acting as the signed-in
  user, and `sessionDestination()` (MFA / password change / portal) from `GET /v1/session`.
- `src/lib/auth.ts` — `getCurrentUser()`, the only place that reads the session.
- `src/proxy.ts` — locale detection, session refresh, redirect of protected routes.
- `messages/` — generated translation catalogs; edit `scripts/legacy-keys.mjs`, then re-run the import.
- `public/brand/` — logos, fonts, photos and the icon sprite, copied from the legacy site.
