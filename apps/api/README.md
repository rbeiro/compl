# @compi/api

HTTP API for the CompI web app and future mobile app: Hono + zod-openapi,
SQL files over Postgres (`pg` + PgTyped), Supabase Auth for identity.
Deploys to Vercel (Node.js functions).

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
- **Queries are `.sql` files** in `src/queries/` (PgTyped). Each annotated query
  becomes a typed function in the generated `*.queries.ts` next to it:

  ```sql
  /* @name listMyHotels */
  SELECT hotel_key AS "hotelKey!", access_rank AS "accessRank!"
  FROM public.compi_my_access();
  ```

  ```ts
  import { listMyHotels } from "../queries/access.queries.js";
  const hotels = await asUser(pool, claims, (tx) => listMyHotels.run(undefined, tx));
  ```

  Parameters are `:name` (`:name!` = required); a `"!"` at the end of a column
  alias marks it non-null in the generated type. Types come from the real
  schema, so regenerate after editing SQL: `pnpm --filter @compi/api db:gen`
  (uses the local `compi_dev` database, see below). Commit the generated files;
  builds do not need a database. Free-text comments go inside the query body
  (`-- ...`), not in the `@name` block.
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

1. Add the query to `src/queries/<area>.sql` and run `pnpm --filter @compi/api db:gen`.
2. Add the route with zod request/response schemas in `src/routes/<area>.ts`.
3. Add tests in `test/` against the real schema with seeded data.
4. Update the client: `pnpm --filter @compi/api openapi:export` (writes the spec
   to `packages/api-client` and regenerates its types).

## Tests and local database

Tests load the **production schema** (`supabase/inventory/remote_schema.sql`) into
a fresh local database, on top of `test/db/supabase-shim.sql`, which provides the
few Supabase objects the schema needs (`auth.uid()`, `auth.users`, roles...). That
shim is also the checklist for running on another Postgres host.

- Requires PostgreSQL 15+; set `TEST_DATABASE_ADMIN_URL` if it is not
  `postgres://postgres:postgres@127.0.0.1:5432/postgres`.
- `pnpm --filter @compi/api db:local` creates `compi_dev` with the same schema
  plus demo data (`dev/seed.sql`), for development and `db:gen`.
- `pnpm --filter @compi/api dev:auth` runs a local stand-in for Supabase Auth
  (`dev/fake-supabase-auth.ts`, port 9999, password `compi-dev` for every
  seeded user). It signs ES256 tokens and serves a JWKS like Supabase, so the
  web app and the API verify them with their production code. Development only.
- When the production schema changes, re-dump `remote_schema.sql`
  (see the root `CLAUDE.md`) so tests follow it.

## Local stack without Supabase

```bash
pnpm --filter @compi/api db:local     # compi_dev: production schema + demo users
pnpm --filter @compi/api dev:auth     # fake Supabase Auth on :9999
# apps/api/.env:  SUPABASE_URL=http://127.0.0.1:9999  (no JWT secret)
pnpm dev:api                          # :8787
# apps/web/.env.local: NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9999, API_URL=http://localhost:8787
pnpm dev                              # :3000 — sign in as cocinero@compichef.test / compi-dev
```

Demo users: `cocinero@` (rank 3, opens the portal), `chef@` (rank 1, sent to
two-step verification), `temporal@` (temporary password).

## Deploying (Vercel)

Full steps, including every environment variable: [`docs/deploy.md`](../../docs/deploy.md).


- Create a Vercel project with **Root Directory `apps/api`**. Vercel's Hono preset
  deploys the default export of `src/index.ts` as a Node.js function; no
  `vercel.json` is needed. `src/node.ts` is only for running locally or on other hosts.
- Environment variables: `DATABASE_URL` (Supabase **transaction pooler**, port
  6543), `SUPABASE_URL`, `CORS_ORIGINS` (the web app's origin), and
  `SUPABASE_JWT_SECRET` only if the project still uses the legacy shared secret.
- `attachDatabasePool` (from `@vercel/functions`) lets each function instance
  close idle connections before it is suspended.
- Check the first deploy against Vercel's current Hono docs; the entry-point
  conventions could not be verified from the development sandbox.
