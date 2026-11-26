# Deploying CompI (Supabase + Vercel)

This guide sets up the new stack from zero:

- one new Supabase project (database, Auth, Storage);
- two Vercel projects: the API (`apps/api`) and the web app (`apps/web`);
- optionally, a copy of the data from the legacy project (`dzfwdxhbldnfqowrnhxf`, `chefi-laboratorio`).

The legacy project is only **read**. Every command that touches it is a dump or a download; nothing below writes to it.

Placeholders used throughout:

| Placeholder | Meaning |
| --- | --- |
| `NEW_REF` | ref of the new Supabase project (Project Settings → General) |
| `NEW_DB_URL` | new project's **session pooler** or direct connection string (port 5432), for the setup and restore commands |
| `OLD_DB_URL` | legacy project's connection string (port 5432), read-only use |
| `REGION` | the new project's region, e.g. `eu-west-3` |

Connection strings are under **Connect** (top bar of the dashboard). If your network has no IPv6, use the *Session pooler* string, not *Direct connection*. URL-encode special characters in the password.

Tools needed on your computer: Node 22, pnpm, and the PostgreSQL 17 client (`pg_dump`, `psql`). Check with `pg_dump --version`; it must be the same major version as the server or newer. `rclone` is needed only if you copy files from the legacy project.

---

## 1. Create and populate the Supabase project

### 1.1 Create the project

1. Create a project in the Supabase dashboard. Pick a region near Barcelona (for example `eu-west-3`, Paris) and save the database password in your password manager.
2. **Authentication → Sign In / Providers**:
   - Turn **Allow new users to sign up** off. Accounts are created by the API (staff invitations) with the secret key, which still works with sign-ups off.
   - Leave the Email provider enabled (email + password).
3. **Authentication → URL Configuration**: set **Site URL** to the web app's URL (e.g. `https://compichef.com`).
4. Emails (two-step codes, invitations, recovery) are sent by the API through Resend, not by Supabase, so Supabase's SMTP settings are not used.

### 1.2 Create the schema (migrations)

From the repository root:

```bash
pnpm install
```

```bash
npx supabase login
```

```bash
npx supabase link --project-ref NEW_REF
```

```bash
npx supabase db push
```

`db push` applies the four files in `supabase/migrations/`:

| Migration | What it creates |
| --- | --- |
| `…000000_baseline.sql` | the whole production schema (`public` + `compi_private`: tables, functions, RLS) |
| `…000100_storage_buckets.sql` | the private buckets `plating-guides`, `compi-guide-media`, `compi-arts-catalog`, `compi-arts-media` |
| `…000150_auth_triggers_and_storage_policies.sql` | triggers on `auth.users` (recovery, invitations) and a deny-all policy for client roles on `storage.objects` |
| `…000200_email_second_factor.sql` | tables and functions for the emailed two-step codes |

Check: **Table Editor** shows the `public` tables (`compi_staff`, `compi_arts_guides`, …) and **Storage** shows the four buckets.

### 1.3 Storage keys for the API

The API reads and writes files through Supabase Storage's S3 endpoint.

1. **Project Settings → Storage → S3 Connection**: copy the **Endpoint** (`https://NEW_REF.storage.supabase.co/storage/v1/s3`) and the **Region**.
2. Under **S3 Access Keys**, create a key pair. Keep the secret; it is shown once. It has full access to storage and goes only into the API's Vercel environment.

### 1.4 Data

Choose one:

- **A. Start empty.** Do step 1.5 to create the first executive chef. Everything else (outlets, guides, staff) is created from the app.
- **B. Copy the legacy data.** Follow section 2. Skip 1.5: the existing accounts come with the data.

### 1.5 First executive chef (option A only)

1. **Authentication → Users → Add user → Create new user**. Enter the chef's email and a temporary password, and tick **Auto Confirm User**.
2. In the **SQL Editor**, run this with your own values:

```sql
-- Hotel and its code (the code is used in staff invitation links).
insert into compi_private.hotel_codes (hotel_key, code) values ('hotel-arts-barcelona', 'arts');

-- The executive chef: rank 1 at that hotel.
with u as (select id, email from auth.users where email = 'chef@example.com')
insert into public.compi_staff (hotel_key, user_id, email, employee_name, position_name, outlet_name, access_rank)
select 'hotel-arts-barcelona', id, email, 'Nombre Apellido', 'Chef ejecutivo', 'Cocina central', 1 from u;

insert into public.compi_memberships (user_id, hotel_key)
select id, 'hotel-arts-barcelona' from auth.users where email = 'chef@example.com';

-- Make them choose a new password at first sign-in.
update auth.users set raw_app_meta_data = raw_app_meta_data || '{"compi_must_change": "true"}'
where email = 'chef@example.com';
```

3. Add the outlets (restaurants) of the hotel:

```sql
insert into public.compi_arts_outlets (hotel_key, outlet_key, hotel, outlet) values
  ('hotel-arts-barcelona', 'enoteca', 'Hotel Arts Barcelona', 'Enoteca');
```

Rank 1 signs in with email + password and then a 6-digit code emailed through Resend.

---

## 2. Copy the data from the legacy project (option B)

What is copied:

| Data | How |
| --- | --- |
| Accounts (`auth.users`, `auth.identities`) | database dump. Password hashes are kept, so everyone keeps their password. |
| All CompI data (`public`, `compi_private`): staff, ranks, outlets, guides and their sources, recipe data, costs, mail, schedules, recovery codes, hotel codes, brand, watercolour master | database dump |
| Files (Word/PDF guides, photos, watercolours, the Plaza template) | copied bucket by bucket with `rclone` |
| Vault secrets (assistant keys) | not copied: set them as API environment variables (step 3.1) |

What is not copied: sessions and refresh tokens (everyone signs in again once), Supabase TOTP factors (rank 1 now uses emailed codes), the Auth audit log, and the old migration history.

### 2.1 Before you start

- Do the copy at a quiet time. Changes made in the legacy site after the dump are not in the new project. If the legacy site stays live during the switch, repeat the copy at cut-over (on a freshly re-created new project: run `npx supabase db reset --linked`, then `npx supabase db push`, then sections 2.2–2.4 again; `db reset` erases the new project's data, so never run it while linked to the legacy project).
- The new project must have the schema (1.2) and **no data**. Do not do 1.5.

### 2.2 Dump the data (read-only on the legacy project)

```bash
pg_dump "$OLD_DB_URL" --data-only --quote-all-identifiers \
  --schema public --schema compi_private --schema auth \
  --exclude-table 'auth.schema_migrations' --exclude-table 'auth.sessions' \
  --exclude-table 'auth.refresh_tokens' --exclude-table 'auth.mfa_amr_claims' \
  --exclude-table 'auth.mfa_challenges' --exclude-table 'auth.mfa_factors' \
  --exclude-table 'auth.flow_state' --exclude-table 'auth.one_time_tokens' \
  --exclude-table 'auth.audit_log_entries' --exclude-table 'auth.saml_relay_states' \
  -f compi-data.sql
```

`compi-data.sql` holds personal data and password hashes. Keep it on an encrypted disk, never commit it, and delete it when the migration is verified.

### 2.3 Restore into the new project

```bash
psql "$NEW_DB_URL" --single-transaction -v ON_ERROR_STOP=1 \
  -c 'SET session_replication_role = replica' -f compi-data.sql
```

- `session_replication_role = replica` loads rows without firing triggers or checking foreign keys in between, so table order does not matter and the invitation/recovery triggers on `auth.users` do not run.
- It is one transaction: on any error nothing is written. Fix the cause and run it again.
- If an `auth` table fails because the new project's Auth version has a column the old one lacks or vice versa, add `--exclude-table` for that table in 2.2 only if it is one of the tables already listed as not copied. Report anything else before continuing.

This procedure was rehearsed against the local copy of the schema (`pnpm --filter @compi/api db:local`): the restored database had the same row counts as the source.

### 2.4 Check the counts

Run in both projects (legacy: SQL Editor is read-only for a `select`) and compare:

```sql
select
  (select count(*) from auth.users) as users,
  (select count(*) from public.compi_staff) as staff,
  (select count(*) from public.compi_arts_outlets) as outlets,
  (select count(*) from public.compi_arts_guides) as guides,
  (select count(*) from compi_private.mail_items) as mail,
  (select count(*) from compi_private.hotel_codes) as hotel_codes;
```

### 2.5 Copy the files

The database rows that point to files (`…_files`, `…_sources` tables) were copied in 2.3; this step copies the files themselves. Copying through S3 also creates the `storage.objects` rows in the new project.

1. In the **legacy** project, create an S3 access key (Project Settings → Storage → S3 Access Keys). This adds a credential and changes no data. Delete the key when the copy is done.
2. Configure two rclone remotes (`rclone config`, or `~/.config/rclone/rclone.conf`):

```ini
[old]
type = s3
provider = Other
endpoint = https://dzfwdxhbldnfqowrnhxf.storage.supabase.co/storage/v1/s3
region = LEGACY_REGION
access_key_id = ...
secret_access_key = ...

[new]
type = s3
provider = Other
endpoint = https://NEW_REF.storage.supabase.co/storage/v1/s3
region = REGION
access_key_id = ...
secret_access_key = ...
```

3. See which buckets exist in the legacy project:

```bash
rclone lsd old:
```

4. Copy each bucket (the four the app uses are below; copy any other listed bucket too, after creating it in the new project's Storage page as **private**):

```bash
for b in plating-guides compi-guide-media compi-arts-catalog compi-arts-media; do rclone copy "old:$b" "new:$b" --s3-no-check-bucket --checksum --progress; done
```

5. Check: same number of objects and size on both sides.

```bash
for b in plating-guides compi-guide-media compi-arts-catalog compi-arts-media; do echo "$b"; rclone size "old:$b"; rclone size "new:$b"; done
```

The Plaza cost template is `compi-arts-catalog/arts-plaza/plantilla/b8cb7501….json`; once copied, `GET /v1/costs/plaza` serves it to the executive chef of Hotel Arts.

### 2.6 Assistant secrets

The legacy project keeps the AI assistant keys in Vault (`compi_assistant_openai_api_key`, `compi_assistant_compositor_url`, `compi_assistant_compositor_token`). Vault is not copied. Set them on the API instead (3.1: `OPENAI_API_KEY`, `COMPI_COMPOSITOR_URL`, `COMPI_COMPOSITOR_TOKEN`). The API uses environment variables first and Vault only as a fallback.

To keep them in the new project's Vault instead, run in its SQL Editor:

```sql
select vault.create_secret('sk-...', 'compi_assistant_openai_api_key');
```

### 2.7 After the copy

- Everyone signs in again with their existing password; rank 1 gets an emailed code.
- Edge Functions are not needed in the new project: the API replaces them (documents, uploads, brand, assistant, accounts, invitations, recovery, Plaza template).
- Delete `compi-data.sql` and the legacy S3 key.

---

## 3. Vercel

Create two projects from the same Git repository. Vercel detects pnpm from `pnpm-lock.yaml` at the root.

### 3.1 API project

- **Root Directory**: `apps/api`. **Framework Preset**: Hono. The function is the default export of `src/index.ts`.
- **Functions → Region**: the same region as Supabase (e.g. `cdg1` for `eu-west-3`).
- Suggested domain: `api.compichef.com`.

Environment variables (Production):

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | new project's **Transaction pooler** string (port **6543**) |
| `SUPABASE_URL` | `https://NEW_REF.supabase.co` |
| `SUPABASE_SECRET_KEY` | Project Settings → API Keys → secret key (`sb_secret_…`) |
| `RESEND_API_KEY` | from Resend |
| `EMAIL_FROM` | e.g. `CompI <no-reply@compichef.com>` (domain verified in Resend) |
| `APP_URL` | web app URL, no trailing slash, e.g. `https://compichef.com` |
| `CORS_ORIGINS` | the web app's origin(s), comma-separated |
| `SERVER_SECRET` | 32+ random characters (`openssl rand -base64 48`). Keep it stable: invitation links depend on it. |
| `STORAGE_DRIVER` | `s3` |
| `S3_ENDPOINT` | `https://NEW_REF.storage.supabase.co/storage/v1/s3` |
| `S3_REGION` | the project's region |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | key pair from 1.3 |
| `OPENAI_API_KEY`, `COMPI_COMPOSITOR_URL`, `COMPI_COMPOSITOR_TOKEN` | optional: AI assistant. Without them the generator offers photos only. |
| `COMPI_VISION_MODEL`, `COMPI_IMAGE_MODEL` | optional model overrides |
| `SUPABASE_JWT_SECRET` | leave unset (only for projects on the legacy shared JWT secret) |

The API refuses to start in production without `RESEND_API_KEY` or with local storage.

Check after deploy: `https://api.compichef.com/v1/health` returns `{"ok":true}`; `/docs` shows the API reference.

### 3.2 Web project

- **Root Directory**: `apps/web`. **Framework Preset**: Next.js.
- **Functions → Region**: same as the API.
- Environment variable: `API_URL` = the API's URL (e.g. `https://api.compichef.com`). The web app never talks to Supabase.
- Domains: `compichef.com` (primary) and redirects from `compichef.es`, `compikitchen.com`, `compikitchen.es` (Vercel → Domains → Redirect to `compichef.com`). DNS is at IONOS: add the records Vercel shows there.

### 3.3 Resend

Verify the sending domain (`compichef.com`) in Resend and add its DNS records at IONOS (SPF/DKIM, and the MX/return-path records Resend lists). Until it is verified, emails (two-step codes, invitations, recovery) are rejected.

### 3.4 Known limit: 4.5 MB request bodies

Vercel Functions accept request bodies up to **4.5 MB**. The API allows 10 MB, but on Vercel:

- Word/PDF uploads over 4.5 MB fail (HTTP 413);
- recipe photos sent to the generator or assistant must stay under that size.

Most guides are far smaller. If larger files are needed, uploads would have to go directly to Storage with signed upload URLs (not implemented).

---

## 4. Final checks

1. Sign in as an executive chef: password, then the emailed code.
2. Plating Guides lists the guides; a Word and a PDF download open.
3. Upload a guide file to a draft in the archive.
4. Send an internal mail between two accounts.
5. Invite a test employee (Equipo) and open the emailed link.
6. Change the language to `ar`: layout is right-to-left and hotel content is translated on the device.

Then point `compichef.com` at the Vercel web project. The old frontend host can stay up, pointed at the legacy project, until you switch.
