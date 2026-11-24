-- Auth may update metadata and password in separate statements of the same transaction.
-- Verify both at commit and consume the code only when the password actually changed.
alter table compi_private.backup_codes add column original_fingerprint bytea;
create or replace function public.compi_begin_recovery(address text, code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare backup compi_private.backup_codes%rowtype; uid uuid; lease uuid:=gen_random_uuid();
begin
  if code is null or code !~ '^[A-F0-9]{40}$' then raise insufficient_privilege; end if;
  select id into uid from auth.users where lower(email)=address and email_confirmed_at is not null;
  select b.* into backup from compi_private.backup_codes b where b.owner=uid and b.digest=sha256(convert_to(code,'UTF8')) for update;
  if not found or not compi_private.has_lab_account(uid) or backup.lease_until>clock_timestamp() then raise insufficient_privilege; end if;
  update compi_private.backup_codes set attempt=lease,lease_until=clock_timestamp()+interval '60 seconds',
    original_fingerprint=(select sha256(convert_to(u.encrypted_password,'UTF8')) from auth.users u where u.id=uid) where owner=uid;
  return jsonb_build_object('uid',uid,'attempt',lease);
end $$;
create or replace function public.compi_release_recovery(uid uuid, lease uuid) returns void language sql security definer set search_path='' as $$
  update compi_private.backup_codes set attempt=null,lease_until=null,original_fingerprint=null where owner=uid and attempt=lease
$$;
create or replace function compi_private.finish_recovery() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not compi_private.has_lab_account(new.id) then raise insufficient_privilege; end if;
  delete from compi_private.backup_codes where owner=new.id and attempt::text=new.raw_app_meta_data->>'compi_recovery_attempt'
    and lease_until>clock_timestamp() and original_fingerprint is not null
    and original_fingerprint<>(select sha256(convert_to(u.encrypted_password,'UTF8')) from auth.users u where u.id=new.id);
  if not found then raise insufficient_privilege; end if;
  delete from auth.sessions where user_id=new.id;
  return new;
end $$;
revoke all on function compi_private.finish_recovery() from public,anon,authenticated;
drop trigger compi_commit_recovery on auth.users;
create constraint trigger compi_commit_recovery after update on auth.users
deferrable initially deferred for each row
when (old.raw_app_meta_data->>'compi_recovery_attempt' is distinct from new.raw_app_meta_data->>'compi_recovery_attempt'
  and new.raw_app_meta_data ? 'compi_recovery_attempt') execute function compi_private.finish_recovery();;
