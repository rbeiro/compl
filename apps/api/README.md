# @compi/api

HTTP API for the CompI web app and future mobile app: Hono + zod-openapi,
plain SQL over Postgres (postgres.js), Supabase Auth for identity.

```bash
cp .env.example .env          # point DATABASE_URL at a dev database, never production
pnpm --filter @compi/api dev  # http://localhost:8787  ·  docs: /docs  ·  spec: /v1/openapi.json
pnpm --filter @compi/api test # needs a local PostgreSQL (see below)
```

## How it works

- **Auth stays in Supabase.** Clients sign in with Supabase Auth (supabase-js on web,
  the Supabase SDKs on mobile) and send the access token as `Authorization: Bearer`.
  The API only verifies it (`src/auth/verify-token.ts`: project JWKS, or the legacy
  HS256 secret if the project still uses one).
- **Business rules stay in Postgres.** Each request runs in a transaction as the
  user (`asUser` in `src/db/client.ts`): role `authenticated` plus the token's
  claims in `request.jwt.claims`. The existing `compi_*` functions, `auth.uid()`
  and row-level security then behave exactly as they do behind Supabase's REST API.
  No supabase-js or PostgREST on the server.
- **Queries are plain SQL** in `src/queries/`, mostly calls to the database
  functions. Columns are aliased to camelCase in SQL.
- **Errors** from the database (`PT401`, `PT403`, `PT404`, `PT409`, `PT429`, `42501`,
  `22023`...) map to HTTP statuses in `src/http/errors.ts`. Every error is
  `{ "error": { "code", "message", "detail"? } }`; clients should switch on `code`.

## Endpoints (v1)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/v1/health`, `/v1/health/ready` | Liveness; readiness checks the database. |
| GET | `/v1/session` | MFA / password-change status. Works before the session is fully active. |
| GET | `/v1/me` | User and hotel ranks (`compi_my_access`). |
| GET | `/v1/outlets` | Outlets visible to the user (RLS). |
| GET | `/v1/guides?limit=&cursor=` | Plating guide catalog, keyset-paginated. |

## Adding an endpoint

1. Add the SQL to `src/queries/<area>.ts` (call the database function).
2. Add the route with zod request/response schemas in `src/routes/<area>.ts`.
3. Add tests in `test/` against the real schema with seeded data.

## Tests and local database

Tests load the **production schema** (`supabase/inventory/remote_schema.sql`) into
a fresh local database, on top of `test/db/supabase-shim.sql`, which provides the
few Supabase objects the schema needs (`auth.uid()`, `auth.users`, roles...). That
shim is also the checklist for running on another Postgres host.

- Requires PostgreSQL 15+; set `TEST_DATABASE_ADMIN_URL` if it is not
  `postgres://postgres:postgres@127.0.0.1:5432/postgres`.
- `pnpm --filter @compi/api db:local` creates `compi_dev` with the same schema
  for manual testing.
- When the production schema changes, re-dump `remote_schema.sql`
  (see the root `CLAUDE.md`) so tests follow it.

## Deploying

Runs on Node (`src/node.ts`). The app itself (`createApp`) is runtime-agnostic,
so it can move to Cloudflare Workers later (Hyperdrive for the database).
On Supabase, use the transaction pooler (port 6543); prepared statements are off.
