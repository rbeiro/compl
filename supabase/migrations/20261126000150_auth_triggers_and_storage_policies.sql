-- Objects outside public/compi_private that production relies on but that a
-- schema dump does not include (it skips the auth and storage schemas).
-- Recovered from supabase/history.

-- Recovery: when the API sets a new password with a recovery attempt id, check
-- the lease and end the user's other sessions, at commit time.
drop trigger if exists compi_commit_recovery on auth.users;
create constraint trigger compi_commit_recovery after update on auth.users
  deferrable initially deferred for each row
  when (old.raw_app_meta_data ->> 'compi_recovery_attempt' is distinct from new.raw_app_meta_data ->> 'compi_recovery_attempt'
        and new.raw_app_meta_data ? 'compi_recovery_attempt')
  execute function compi_private.finish_recovery();

-- Invitations: link the confirmed account to its employee record.
drop trigger if exists compi_finish_test_invitation on auth.users;
create trigger compi_finish_test_invitation after insert or update of raw_app_meta_data, email_confirmed_at on auth.users
  for each row when (new.email_confirmed_at is not null and new.raw_app_meta_data ? 'compi_lab_attempt')
  execute function compi_private.finish_lab_identity();

-- Storage: every bucket is private and only the API (server credentials) may
-- touch objects. Supabase enables RLS on storage.objects with no policies, which
-- already denies client roles; the explicit deny policy below is defense in
-- depth. On current Supabase, storage.objects is owned by supabase_storage_admin
-- and the migration role may not alter it: then the policy is skipped.
do $$
begin
  if to_regclass('storage.objects') is null then return; end if;
  execute 'alter table storage.objects enable row level security';
  execute 'drop policy if exists compi_server_only on storage.objects';
  execute 'create policy compi_server_only on storage.objects as restrictive for all to anon, authenticated using (false) with check (false)';
exception when insufficient_privilege then
  raise notice 'storage.objects is managed by Supabase (RLS on, no client policies): deny policy skipped';
end $$;
