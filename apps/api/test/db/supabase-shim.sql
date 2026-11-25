-- Minimal stand-in for the parts of Supabase that the CompI schema depends on,
-- so the production schema (supabase/inventory/remote_schema.sql) loads into
-- plain PostgreSQL for tests.
--
-- It is also the portability checklist: moving off Supabase means providing
-- exactly these objects (or rewriting the SQL that uses them):
--   roles anon / authenticated / service_role
--   auth.uid(), auth.jwt()            -- read the JWT claims set per transaction
--   auth.users, auth.sessions         -- columns used by the schema only
--   storage.buckets / storage.objects -- buckets, existence checks on uploaded files
--   vault.decrypted_secrets           -- one secret lookup
--   extensions.pgcrypto / uuid-ossp
-- Mirrors Supabase behavior; it is NOT a security boundary by itself.

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists vault;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

-- Same definitions as Supabase: claims come from the `request.jwt.claims`
-- setting, which the API sets with set_config(..., true) per transaction.
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    auth.jwt() ->> 'sub'
  )::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), auth.jwt() ->> 'role')
$$;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  invited_at timestamptz,
  raw_app_meta_data jsonb not null default '{}',
  raw_user_meta_data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  aal text,
  not_after timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  name text not null,
  owner uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table if not exists vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text unique,
  secret text not null
);
create or replace view vault.decrypted_secrets as
  select id, name, secret as decrypted_secret from vault.secrets;

grant usage on schema auth, extensions, storage to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

-- Supabase Realtime broadcasts changes from this publication.
do $$ begin
  if not exists (select from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if;
end $$;
