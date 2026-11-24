-- Authorization and invitation delivery; designed for the existing CompI database.
create or replace function public.compi_needs_mfa() returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce(auth.jwt()->>'aal','') <> 'aal2' and exists (
    select 1 from public.compi_staff s join public.compi_memberships m using(user_id,hotel_key)
    where s.user_id=auth.uid() and s.access_rank=1 and s.withdrawn_at is null)
$$;
revoke all on function public.compi_needs_mfa() from public,anon;
grant execute on function public.compi_needs_mfa() to authenticated;
create or replace function compi_private.active_download_session() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.sessions s where s.id::text=auth.jwt()->>'session_id'
    and s.user_id=auth.uid() and (s.not_after is null or s.not_after>now()))
    and not public.compi_needs_mfa()
$$;
-- Invitation acceptance is the sole operation that binds a pending employee to a user.
create or replace function public.compi_activate_access() returns void language plpgsql security invoker set search_path='' as $$
begin
 if not compi_private.active_download_session() then raise exception using errcode='PT401',message='Vuelve a identificarte.'; end if;
end $$;
drop function compi_private.claim_staff();
update public.compi_staff set invite_state='prepared' where user_id is null and invite_state is null and withdrawn_at is null;
create or replace function compi_private.staff_change(h text, op text, item jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare r int := (item->>'rank')::int; old_rank int; target uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(h,731));
  if compi_private.my_rank(h) is distinct from 1 then raise insufficient_privilege; end if;
  if r is null or r not between 1 and 3 then raise exception using errcode='22023',message='Rango inválido'; end if;
  if op='rank' then
    select access_rank,user_id into old_rank,target from public.compi_staff where hotel_key=h and id=(item->>'id')::uuid and withdrawn_at is null for update;
    if not found then raise insufficient_privilege; end if;
    if old_rank is distinct from (item->>'previous')::int then raise exception using errcode='PT409',message='Otro usuario ha modificado el rango'; end if;
    if old_rank=1 and r<>1 and target is not null and not exists
      (select 1 from public.compi_staff where hotel_key=h and access_rank=1 and user_id is not null and user_id<>target and withdrawn_at is null) then
      raise exception using errcode='PT409',message='Debe quedar un administrador activo en el hotel';
    end if;
    update public.compi_staff set access_rank=r where hotel_key=h and id=(item->>'id')::uuid;
  else raise exception using errcode='22023',message='Operación inválida'; end if;
end $$;

alter table compi_private.lab_mail_outbox drop constraint if exists lab_mail_outbox_recipient_check;
alter table compi_private.lab_mail_outbox add constraint lab_mail_outbox_recipient_check
 check(recipient ~ '^[a-z0-9._+-]+@compi[.]invalid$');
-- Invalidate outstanding links previously visible to issuers.
delete from compi_private.lab_tickets t using public.compi_staff s where t.employee=s.id and s.invite_state='issued';
update public.compi_staff set invite_state='prepared',invite_revision=gen_random_uuid(),invite_until=null
 where user_id is null and invite_state='issued';
create or replace function public.compi_manage_invitation(h text, employee uuid, op text, previous uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.compi_staff%rowtype; box compi_private.lab_mail_outbox%rowtype;
 ticket text; rev uuid:=gen_random_uuid(); deadline timestamptz; mime text; body text;
begin
 if not compi_private.active_download_session() or compi_private.my_rank(h) is distinct from 1 then raise insufficient_privilege; end if;
 select * into s from public.compi_staff where id=employee and hotel_key=h for update;
 if not found or s.email !~ '^[a-z0-9._+-]+@compi[.]invalid$' then raise insufficient_privilege; end if;
 if s.user_id is not null or s.withdrawn_at is not null then raise exception using errcode='PT409',message='El empleado ya está activo o retirado. Actualiza la lista.'; end if;
 if op='send' and s.invite_state in ('queued','delivered') and s.invite_until>now() then
  return jsonb_build_object('queued',true,'state',s.invite_state);
 end if;
 if op is null or op not in ('send','replace','cancel') or s.invite_revision is distinct from previous then
  raise exception using errcode='PT409',message='La invitación ha cambiado. Actualiza la lista.';
 end if;
 select * into box from compi_private.lab_mail_outbox b where b.employee=s.id for update;
 if op='cancel' then
  delete from compi_private.lab_tickets t where t.employee=s.id;
  update compi_private.lab_mail_outbox b set message=null,attempt=null,lease_until=null,queued_at=null where b.employee=s.id;
  update public.compi_staff set invite_state='cancelled',invite_until=null,invite_revision=rev where id=s.id;
  return jsonb_build_object('state','cancelled');
 end if;
 if op='send' and s.invite_state is not null and s.invite_state<>'prepared' then raise exception using errcode='PT409',message='Utiliza Reenviar invitación.'; end if;
 if box.employee is null or box.recipient<>s.email or box.relay_key_hash is null or box.expires_at<=now() then
  return jsonb_build_object('state','channel_required');
 end if;
 ticket:='v7_'||replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 deadline:=now()+interval '1 hour';
 insert into compi_private.lab_tickets(employee,digest) values(s.id,sha256(convert_to(ticket,'UTF8')))
 on conflict on constraint lab_tickets_pkey do update set digest=excluded.digest,attempt=null,lease_until=null;
  deadline:=least(deadline,box.expires_at);
  body:='Has recibido una invitación a CompI Laboratorio.'||E'\r\n\r\n'||'Abre el enlace para establecer tu contraseña:'||E'\r\n'||
   'https://compi-laboratorio.leonardo-vincere.chatgpt.site/invitacion.html#'||ticket||E'\r\n\r\n'||'El enlace es de un solo uso.';
  mime:=concat_ws(E'\r\n','From: CompI Laboratorio <invitaciones@compi.invalid>','To: '||s.email,
   'Subject: =?UTF-8?B?VHUgaW52aXRhY2nDs24gYSBDb21wSSBMYWJvcmF0b3Jpbw==?=',
   'Message-ID: <'||rev||'@compi.invalid>','Date: '||to_char(now() at time zone 'UTC','Dy, DD Mon YYYY HH24:MI:SS')||' +0000',
   'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',
   replace(encode(convert_to(body,'UTF8'),'base64'),E'\n',E'\r\n'),'');
  update compi_private.lab_mail_outbox b set message=mime,queued_at=now(),attempt=null,lease_until=null where b.employee=s.id;

 update public.compi_staff set invite_state='queued',invite_until=deadline,invite_revision=rev where id=s.id;
 return jsonb_build_object('queued',true,'state','queued');
end $$;
create or replace function public.compi_lab_relay(addr text, proof text, receipt uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid; s public.compi_staff%rowtype; b compi_private.lab_mail_outbox%rowtype; a uuid:=gen_random_uuid();
begin
 if proof is null or proof !~ '^[a-f0-9]{64}$' or addr !~ '^[a-z0-9._+-]+@compi[.]invalid$' then raise insufficient_privilege; end if;
 select employee into sid from compi_private.lab_mail_outbox where recipient=addr
 and relay_key_hash=encode(sha256(convert_to(proof,'UTF8')),'hex') and expires_at>now();
 if sid is null then raise insufficient_privilege; end if;
 select * into s from public.compi_staff where id=sid for update;
 select * into b from compi_private.lab_mail_outbox where employee=sid for update;
 if s.invite_state is distinct from 'queued' or s.invite_until<=now() or b.message is null then return '{}'::jsonb; end if;
 if receipt is not null then
  if b.attempt is distinct from receipt then return '{}'::jsonb; end if;
  update compi_private.lab_mail_outbox set message=null,attempt=null,lease_until=null where employee=sid;
  update public.compi_staff set invite_state='delivered' where id=sid;
  return '{"delivered":true}'::jsonb;
 end if;
 if b.lease_until>now() then return '{}'::jsonb; end if;
 update compi_private.lab_mail_outbox set attempt=a,lease_until=now()+interval '30 seconds' where employee=sid;
 return jsonb_build_object('receipt',a,'message',b.message);
end $$;

-- Transport is available only to the trusted delivery service.
revoke all on function public.compi_lab_relay(text,text,uuid) from public,anon,authenticated;
grant execute on function public.compi_lab_relay(text,text,uuid) to service_role;
alter table compi_private.generated_drafts enable row level security;
-- Preserve only the address reservation after the original staff record is removed.
alter table compi_private.address_allocations alter column submitted drop not null,
 alter column registrar drop not null, alter column hotel drop not null;
create or replace function compi_private.minimize_allocation() returns trigger language plpgsql security definer set search_path='' as $$
begin update compi_private.address_allocations set submitted=null,registrar=null,hotel=null where request_id=old.id; return old; end $$;
revoke all on function compi_private.minimize_allocation() from public,anon,authenticated;
create trigger compi_minimize_allocation after delete on public.compi_staff for each row execute function compi_private.minimize_allocation();
update compi_private.address_allocations a set submitted=null,registrar=null,hotel=null
 where not exists(select 1 from public.compi_staff s where s.id=a.request_id);
create or replace function compi_private.register_address(h text, request_id uuid, given_name text, surname text,
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
    if existing.registrar is distinct from auth.uid() or existing.hotel is distinct from h or existing.submitted is distinct from submitted then raise insufficient_privilege; end if;
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

-- Only immutable, validated uploads can become the current file.
create table compi_private.validated_files (
 hotel_key text not null,outlet_key text not null,guide_key text not null,
 format text not null check(format in ('pdf','docx')), digest text not null check(digest ~ '^[0-9a-f]{64}$'),
 primary key(hotel_key,outlet_key,guide_key,format),
 foreign key(hotel_key,outlet_key,guide_key) references public.compi_guides on delete cascade
);
alter table compi_private.validated_files enable row level security;
revoke all on compi_private.validated_files from public,anon,authenticated;
create function compi_private.file_access(h text,o text,g text,fmt text,editing boolean)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare guide public.compi_guides; rank smallint:=compi_private.my_rank(h); sha text;
begin
 if rank is null or fmt is null or fmt not in ('pdf','docx') or editing is null then raise insufficient_privilege;end if;
 select v.* into guide from public.compi_guides v join public.compi_outlets x using(hotel_key,outlet_key)
  where v.hotel_key=h and v.outlet_key=o and v.guide_key=g and not x.archived and
   (v.guide_state='ready' or (editing and v.guide_state='draft' and (rank=1 or v.created_by=auth.uid())));
 if not found or (editing and rank>2) then raise insufficient_privilege;end if;
 select f.digest into sha from compi_private.validated_files f where (f.hotel_key,f.outlet_key,f.guide_key,f.format)=(h,o,g,fmt);
 return jsonb_build_object('prefix',guide.object_prefix,'digest',sha,'path',guide.object_prefix||
   case when sha is null then '' else 'validated/'||sha||'/' end||'ficha.'||fmt);
end $$;
create function public.compi_file_access(h text,o text,g text,fmt text,editing boolean)
returns jsonb language sql stable security invoker set search_path='' as $$select compi_private.file_access(h,o,g,fmt,editing)$$;
create function compi_private.commit_file(h text,o text,g text,fmt text,sha text,previous text)
returns void language plpgsql security definer set search_path='' as $$
declare info jsonb; path text;
begin
 perform pg_advisory_xact_lock(hashtextextended(h,731));
 info:=compi_private.file_access(h,o,g,fmt,true);
 if sha is null or sha !~ '^[a-f0-9]{64}$' then raise invalid_parameter_value; end if;
 if info->>'digest'=sha then return;end if;
 if info->>'digest' is distinct from previous then raise exception using errcode='PT409',message='El archivo ha cambiado. Vuelve a abrir la ficha.';end if;
 path:=(info->>'prefix')||'validated/'||sha||'/ficha.'||fmt;
 if not exists(select 1 from storage.objects where bucket_id='plating-guides' and name=path) then raise insufficient_privilege;end if;
 insert into compi_private.validated_files values(h,o,g,fmt,sha)
 on conflict (hotel_key,outlet_key,guide_key,format) do update set digest=excluded.digest;
end $$;
create function public.compi_commit_file(h text,o text,g text,fmt text,sha text,previous text) returns void
language sql security invoker set search_path='' as $$select compi_private.commit_file(h,o,g,fmt,sha,previous)$$;
revoke all on function compi_private.file_access(text,text,text,text,boolean), public.compi_file_access(text,text,text,text,boolean),
 compi_private.commit_file(text,text,text,text,text,text),public.compi_commit_file(text,text,text,text,text,text) from public,anon;
grant execute on function compi_private.file_access(text,text,text,text,boolean), public.compi_file_access(text,text,text,text,boolean),
 compi_private.commit_file(text,text,text,text,text,text),public.compi_commit_file(text,text,text,text,text,text) to authenticated;
-- Deny old read/write endpoints even if a future permissive policy is added.
create policy compi_proxy_only on storage.objects as restrictive for all to anon,authenticated
 using(bucket_id<>'plating-guides') with check(bucket_id<>'plating-guides');
create or replace function compi_private.catalog_change(h text, o text, g text, op text, label text) returns text
language plpgsql security definer set search_path='' as $$
declare r smallint; home_label text; folder_label text; state text; who uuid; prefix text; newkey text:=gen_random_uuid()::text; uid uuid:=auth.uid();
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(h,731));
  r:=compi_private.my_rank(h);
  if r is null or not (op=any(array['new_folder','rename_folder','delete_folder','new_guide','rename_guide','publish','delete_guide'])) then raise insufficient_privilege; end if;
  if op in ('new_folder','rename_folder','delete_folder','delete_guide') then
    if r<>1 then raise insufficient_privilege; end if;
  elsif r>2 then raise insufficient_privilege; end if;
  if op in ('new_folder','rename_folder','new_guide','rename_guide') and (coalesce(length(btrim(label)),0) not between 1 and 120 or label ~ '[[:cntrl:]/]') then
    raise exception using errcode='22023',message='Nombre inválido';
  end if;
  if op='new_folder' then
    select hotel into home_label from public.compi_outlets where hotel_key=h limit 1;
    insert into public.compi_outlets(hotel_key,outlet_key,hotel,outlet) values(h,newkey,coalesce(home_label,h),btrim(label));
    return newkey;
  end if;
  select hotel,outlet into home_label,folder_label from public.compi_outlets where hotel_key=h and outlet_key=o and not archived for update;
  if not found then raise exception using errcode='PT404',message='Carpeta no disponible'; end if;
  if op='rename_folder' then
    update public.compi_outlets set outlet=btrim(label) where hotel_key=h and outlet_key=o;
    update public.compi_guides set outlet=btrim(label) where hotel_key=h and outlet_key=o;
  elsif op='delete_folder' then
    update public.compi_outlets set archived=true where hotel_key=h and outlet_key=o;
  elsif op='new_guide' then
    insert into public.compi_guides(hotel_key,outlet_key,guide_key,hotel,outlet,title,guide_state,created_by)
    values(h,o,newkey,home_label,folder_label,btrim(label),'draft',uid);
    return newkey;
  else
    select guide_state,created_by,object_prefix into state,who,prefix from public.compi_guides
    where hotel_key=h and outlet_key=o and guide_key=g and guide_state<>'archived' for update;
    if not found or (state='draft' and who is distinct from uid and r<>1) then raise insufficient_privilege; end if;
    if op='rename_guide' then update public.compi_guides set title=btrim(label) where hotel_key=h and outlet_key=o and guide_key=g;
    elsif op='delete_guide' then update public.compi_guides set guide_state='archived' where hotel_key=h and outlet_key=o and guide_key=g;
    elsif op='publish' then
      if (select count(*) from compi_private.validated_files f where (f.hotel_key,f.outlet_key,f.guide_key)=(h,o,g))<>2 then
        raise exception using errcode='PT409',message='Valida y sube tanto el Word como el PDF antes de publicar.'; end if;
      update public.compi_guides set guide_state='ready' where hotel_key=h and outlet_key=o and guide_key=g;
    end if;
  end if;
  return coalesce(g,o);
end $$;
create or replace function compi_private.reserve_generated_draft(h text,o text,ticket uuid,label text,fingerprint text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing compi_private.generated_drafts%rowtype; guide public.compi_guides%rowtype; key text; uid uuid:=auth.uid();
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(h,731));
  if uid is null or not exists(select 1 from public.compi_generator_outlet(h,o)) then raise insufficient_privilege; end if;
  if ticket is null or fingerprint is null or fingerprint !~ '^[0-9a-f]{64}$' then raise invalid_parameter_value; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text||ticket::text,912));
  select * into existing from compi_private.generated_drafts d where d.author=uid and d.request_id=ticket;
  if found then
    if existing.hotel_key<>h or existing.outlet_key<>o or existing.fingerprint<>fingerprint then
      raise exception using errcode='PT409',message='Esta generación ya corresponde a otro borrador.';
    end if;
    key:=existing.guide_key;
  else
    key:=compi_private.catalog_change(h,o,'','new_guide',label);
    insert into compi_private.generated_drafts values(uid,ticket,h,o,key,fingerprint);
  end if;
  select * into strict guide from public.compi_guides g where g.hotel_key=h and g.outlet_key=o and g.guide_key=key;
  if guide.guide_state<>'draft' then raise exception using errcode='PT409',message='El borrador ya se ha publicado o retirado.'; end if;
  return jsonb_build_object('key',key,'prefix',guide.object_prefix,
    'docx',exists(select 1 from compi_private.validated_files f where (f.hotel_key,f.outlet_key,f.guide_key,f.format)=(h,o,key,'docx')),
    'pdf',exists(select 1 from compi_private.validated_files f where (f.hotel_key,f.outlet_key,f.guide_key,f.format)=(h,o,key,'pdf')));
end $$;
;
