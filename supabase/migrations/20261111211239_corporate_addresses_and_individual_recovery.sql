-- Keep the original allocation even after a staff record is deleted.
create table compi_private.address_allocations (
  request_id uuid primary key, address text not null unique,
  hotel text not null, registrar uuid not null, submitted jsonb not null
);
alter table compi_private.address_allocations enable row level security;
revoke all on compi_private.address_allocations from public,anon,authenticated;

create function compi_private.register_address(h text, request_id uuid, given_name text, surname text,
  position_name text, outlet_name text, access_rank smallint) returns text
language plpgsql security definer set search_path='' as $$
declare
  given text := regexp_replace(lower(pg_catalog.normalize(btrim(given_name),'NFKD')),'[^a-z]','','g');
  family text := regexp_replace(lower(pg_catalog.normalize(btrim(surname),'NFKD')),'[^a-z]','','g');
  full_name text := concat_ws(' ',btrim(given_name),btrim(surname));
  submitted jsonb := jsonb_build_array(full_name,position_name,outlet_name,access_rank);
  existing compi_private.address_allocations%rowtype;
  letters text; stem text; suffix text; candidate text; step int:=1;
begin
  if not compi_private.active_download_session() or compi_private.my_rank(h) is distinct from 1 then raise insufficient_privilege; end if;
  if request_id is null or coalesce(given,'')='' or coalesce(family,'')='' or length(full_name)>120 or
     coalesce(length(btrim(position_name)),0) not between 1 and 120 or coalesce(length(btrim(outlet_name)),0) not between 1 and 120 or
     access_rank is null or access_rank not between 1 and 3 then
    raise exception using errcode='22023',message='Revisa el nombre, el apellido, el puesto, el outlet y el rango.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('compi.corporate.addresses',14));
  select a.* into existing from compi_private.address_allocations a where a.request_id=register_address.request_id;
  if found then
    if existing.registrar<>auth.uid() or existing.hotel<>h or existing.submitted<>submitted then raise insufficient_privilege; end if;
    return existing.address;
  end if;
  -- After the initial, prefer consonants in name order (Eustaquio -> es -> est).
  letters:=left(given,1)||regexp_replace(substr(given,2),'[aeiou]','','g')||regexp_replace(substr(given,2),'[^aeiou]','','g');
  family:=left(family,48); letters:=left(letters,12);
  loop
    stem:=left(letters,step);
    suffix:=case when step>length(letters) then (step-length(letters)+1)::text else '' end;
    candidate:=stem||suffix||'.'||family||'@compi.invalid';
    exit when not exists(select 1 from compi_private.address_allocations a where a.address=candidate)
      and not exists(select 1 from public.compi_staff s where s.email=candidate)
      and not exists(select 1 from auth.users u where lower(u.email)=candidate);
    step:=step+1;
  end loop;
  insert into compi_private.address_allocations values(request_id,candidate,h,auth.uid(),submitted);
  insert into public.compi_staff(id,hotel_key,employee_name,email,position_name,outlet_name,access_rank,invite_state)
    values(request_id,h,full_name,candidate,btrim(position_name),btrim(outlet_name),access_rank,'prepared');
  return candidate;
end $$;
create function public.compi_register_employee(h text, request_id uuid, given_name text, surname text, position_name text, outlet_name text, access_rank smallint)
returns text language sql security invoker set search_path='' as $$
  select compi_private.register_address(h,request_id,given_name,surname,position_name,outlet_name,access_rank)
$$;
revoke all on function compi_private.register_address(text,uuid,text,text,text,text,smallint),public.compi_register_employee(text,uuid,text,text,text,text,smallint) from public,anon;
grant execute on function compi_private.register_address(text,uuid,text,text,text,text,smallint),public.compi_register_employee(text,uuid,text,text,text,text,smallint) to authenticated;

create table compi_private.backup_codes (
  owner uuid primary key references auth.users(id) on delete cascade, digest bytea not null unique,
  attempt uuid, lease_until timestamptz
);
alter table compi_private.backup_codes enable row level security;
revoke all on compi_private.backup_codes from public,anon,authenticated;

create function compi_private.has_lab_account(uid uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.compi_staff s join public.compi_memberships m using(user_id,hotel_key)
   join auth.users u on u.id=s.user_id and lower(u.email)=s.email
   where s.user_id=uid and s.withdrawn_at is null and s.email like '%@compi.invalid')
$$;
revoke all on function compi_private.has_lab_account(uuid) from public,anon,authenticated;

create function compi_private.personal_backup(issue boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid := auth.uid(); code text;
begin
  if not compi_private.active_download_session() or not compi_private.has_lab_account(uid) then raise insufficient_privilege; end if;
  if issue then
    if not exists(select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]')) a
      where a->>'method'='password' and (a->>'timestamp')::bigint >= extract(epoch from now())-300)
      then raise exception using errcode='PT403',message='Vuelve a iniciar sesión para generar un código.'; end if;
    code:=upper(encode(extensions.gen_random_bytes(20),'hex'));
    insert into compi_private.backup_codes(owner,digest) values(uid,sha256(convert_to(code,'UTF8')))
      on conflict(owner) do update set digest=excluded.digest,attempt=null,lease_until=null;
    return jsonb_build_object('code',code);
  end if;
  return jsonb_build_object('configured',exists(select 1 from compi_private.backup_codes b where b.owner=uid));
end $$;
create function public.compi_personal_backup(issue boolean default false) returns jsonb language sql security invoker set search_path='' as $$
  select compi_private.personal_backup(issue)
$$;
revoke all on function public.compi_personal_backup(boolean),compi_private.personal_backup(boolean) from public,anon;
grant execute on function public.compi_personal_backup(boolean),compi_private.personal_backup(boolean) to authenticated;

-- The worker may change a password only when the holder proves possession of the employee's code.
create function public.compi_begin_recovery(address text, code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare backup compi_private.backup_codes%rowtype; uid uuid; lease uuid:=gen_random_uuid();
begin
  if code is null or code !~ '^[A-F0-9]{40}$' then raise insufficient_privilege; end if;
  select id into uid from auth.users where lower(email)=address and email_confirmed_at is not null;
  select b.* into backup from compi_private.backup_codes b where b.owner=uid and b.digest=sha256(convert_to(code,'UTF8')) for update;
  if not found or not compi_private.has_lab_account(uid) or backup.lease_until>clock_timestamp() then raise insufficient_privilege; end if;
  update compi_private.backup_codes set attempt=lease,lease_until=clock_timestamp()+interval '60 seconds' where owner=uid;
  return jsonb_build_object('uid',uid,'attempt',lease);
end $$;
create function public.compi_release_recovery(uid uuid, lease uuid) returns void language sql security definer set search_path='' as $$
  update compi_private.backup_codes set attempt=null,lease_until=null where owner=uid and attempt=lease
$$;
revoke all on function public.compi_begin_recovery(text,text),public.compi_release_recovery(uuid,uuid) from public,anon,authenticated;
grant execute on function public.compi_begin_recovery(text,text),public.compi_release_recovery(uuid,uuid) to service_role;

-- Commit the password update, one-time use and revocation of previous sessions together.
create function compi_private.finish_recovery() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not compi_private.has_lab_account(new.id) then raise insufficient_privilege; end if;
  delete from compi_private.backup_codes where owner=new.id and attempt::text=new.raw_app_meta_data->>'compi_recovery_attempt'
    and lease_until>clock_timestamp();
  if not found or old.encrypted_password is not distinct from new.encrypted_password then raise insufficient_privilege; end if;
  delete from auth.sessions where user_id=new.id;
  return new;
end $$;
revoke all on function compi_private.finish_recovery() from public,anon,authenticated;
create trigger compi_commit_recovery after update on auth.users for each row
when (old.raw_app_meta_data->>'compi_recovery_attempt' is distinct from new.raw_app_meta_data->>'compi_recovery_attempt'
  and new.raw_app_meta_data ? 'compi_recovery_attempt') execute function compi_private.finish_recovery();;
