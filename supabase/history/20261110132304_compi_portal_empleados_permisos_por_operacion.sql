create schema if not exists compi_private;
revoke all on schema compi_private from public, anon;
grant usage on schema compi_private to authenticated;

create table public.compi_staff (
  id uuid primary key default gen_random_uuid(),
  hotel_key text not null,
  user_id uuid references auth.users(id) on delete set null,
  email text not null check (email = lower(btrim(email)) and length(email) between 3 and 254),
  employee_name text not null check (length(btrim(employee_name)) between 1 and 120),
  position_name text not null check (length(btrim(position_name)) between 1 and 120),
  outlet_name text not null check (length(btrim(outlet_name)) between 1 and 120),
  access_rank smallint not null default 3 check (access_rank in (1,2,3)),
  unique (hotel_key,email), unique (user_id,hotel_key)
);
create index compi_staff_email_pending on public.compi_staff(email) where user_id is null;
alter table public.compi_staff enable row level security;
revoke all on public.compi_staff from public, anon, authenticated;
grant select on public.compi_staff to authenticated;

-- These helpers run outside the exposed schema. The caller cannot supply an identity.
create function compi_private.my_rank(h text) returns smallint
language sql stable security definer set search_path = '' as $$
  select s.access_rank from public.compi_staff s
  join public.compi_memberships m on m.user_id=s.user_id and m.hotel_key=s.hotel_key
  where s.hotel_key=h and s.user_id=(select auth.uid());
$$;
create policy staff_visibility on public.compi_staff for select to authenticated using
(user_id=(select auth.uid()) or compi_private.my_rank(hotel_key)=1);

create function compi_private.claim_staff() returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid := auth.uid(); verified_email text; h text;
begin
  select lower(email) into verified_email from auth.users where id=uid and email_confirmed_at is not null;
  if verified_email is null then return; end if;
  for h in update public.compi_staff set user_id=uid where user_id is null and email=verified_email returning hotel_key loop
    insert into public.compi_memberships(user_id,hotel_key) values(uid,h) on conflict do nothing;
  end loop;
end $$;
create function public.compi_activate_access() returns void language sql security invoker set search_path=''
as $$ select compi_private.claim_staff() $$;

create function compi_private.staff_change(h text, op text, item jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare r int := (item->>'rank')::int; old_rank int; target uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(h,731));
  if compi_private.my_rank(h) is distinct from 1 then raise insufficient_privilege; end if;
  if r is null or r not between 1 and 3 then raise exception using errcode='22023',message='Rango inválido'; end if;
  if op='register' then
    if coalesce(item->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception using errcode='22023',message='Correo inválido';
    end if;
    insert into public.compi_staff(hotel_key,employee_name,email,position_name,outlet_name,access_rank)
      values(h,btrim(item->>'name'),lower(btrim(item->>'email')),btrim(item->>'position'),btrim(item->>'outlet'),r);
  elsif op='rank' then
    select access_rank,user_id into old_rank,target from public.compi_staff where hotel_key=h and id=(item->>'id')::uuid for update;
    if not found then raise insufficient_privilege; end if;
    if old_rank is distinct from (item->>'previous')::int then raise exception using errcode='PT409',message='Otro usuario ha modificado el rango'; end if;
    if old_rank=1 and r<>1 and target is not null and not exists
      (select 1 from public.compi_staff where hotel_key=h and access_rank=1 and user_id is not null and user_id<>target) then
      raise exception using errcode='PT409',message='Debe quedar un administrador activo en el hotel';
    end if;
    update public.compi_staff set access_rank=r where hotel_key=h and id=(item->>'id')::uuid;
  else raise exception using errcode='22023',message='Operación inválida'; end if;
end $$;
create function public.compi_staff_change(h text,op text,item jsonb) returns void language sql security invoker set search_path=''
as $$ select compi_private.staff_change(h,op,item) $$;

create table public.compi_outlets (
 hotel_key text not null, outlet_key text not null, hotel text not null, outlet text not null check(length(btrim(outlet)) between 1 and 120),
 archived boolean not null default false, primary key(hotel_key,outlet_key)
);
create unique index compi_outlets_display on public.compi_outlets(hotel_key,lower(outlet)) where not archived;
insert into public.compi_outlets(hotel_key,outlet_key,hotel,outlet)
 select distinct hotel_key,outlet_key,hotel,outlet from public.compi_guides;
alter table public.compi_outlets enable row level security;
revoke all on public.compi_outlets from public,anon,authenticated;
grant select on public.compi_outlets to authenticated;
create policy hotel_outlets_read on public.compi_outlets for select to authenticated
using (not archived and compi_private.my_rank(hotel_key) between 1 and 3);

alter table public.compi_guides add column guide_state text not null default 'ready' check(guide_state in ('draft','ready','archived')),
 add column created_by uuid references auth.users(id) on delete set null;
alter policy read_hotel_guides on public.compi_guides using (
 compi_private.my_rank(hotel_key) between 1 and 3 and
 exists(select 1 from public.compi_outlets o where o.hotel_key=compi_guides.hotel_key and o.outlet_key=compi_guides.outlet_key and not o.archived)
 and (guide_state='ready' or (guide_state='draft' and (created_by=(select auth.uid()) or compi_private.my_rank(hotel_key)=1)))
);

create function compi_private.catalog_change(h text, o text, g text, op text, label text) returns text
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
      if (select count(*) from storage.objects where bucket_id='plating-guides' and name in (prefix||'ficha.docx',prefix||'ficha.pdf'))<>2 then
        raise exception using errcode='PT409',message='Falta el Word o el PDF'; end if;
      update public.compi_guides set guide_state='ready' where hotel_key=h and outlet_key=o and guide_key=g;
    end if;
  end if;
  return coalesce(g,o);
end $$;
create function public.compi_catalog_change(h text,o text,g text,op text,label text) returns text language sql security invoker set search_path=''
as $$ select compi_private.catalog_change(h,o,g,op,label) $$;

-- Storage paths come exclusively from a live, visible catalogue entry for the caller's hotel.
create function compi_private.can_write_file(path text) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.compi_guides g
  join public.compi_memberships m on m.hotel_key=g.hotel_key and m.user_id=(select auth.uid())
  where g.hotel_key=split_part(path,'/',1) and compi_private.my_rank(g.hotel_key) in (1,2)
  and path in (g.object_prefix||'ficha.docx',g.object_prefix||'ficha.pdf'));
$$;
alter policy read_hotel_guide_files on storage.objects using (
 bucket_id='plating-guides' and (
   storage.allow_any_operation(array['object.get_authenticated','object.get_authenticated_info','object.head_authenticated_info','object.list','object.list_v2'])
   or (storage.allow_any_operation(array['object.upload','object.upload_update']) and compi_private.my_rank(split_part(storage.objects.name,'/',1)) in (1,2) and compi_private.can_write_file(storage.objects.name))
 )
 and exists (select 1 from public.compi_memberships m join public.compi_guides g on g.hotel_key=m.hotel_key
 where m.user_id=(select auth.uid()) and m.hotel_key=(storage.foldername(storage.objects.name))[1]
 and storage.objects.name in (g.object_prefix || 'ficha.docx',g.object_prefix || 'ficha.pdf'))
);
create policy edit_known_file on storage.objects for update to authenticated
 using(bucket_id='plating-guides' and storage.allow_any_operation(array['object.upload','object.upload_update']) and compi_private.can_write_file(name))
 with check(bucket_id='plating-guides' and storage.allow_any_operation(array['object.upload','object.upload_update']) and compi_private.can_write_file(name));
create policy upload_known_file on storage.objects for insert to authenticated
 with check(bucket_id='plating-guides' and storage.allow_any_operation(array['object.upload','object.upload_update']) and compi_private.can_write_file(name));

revoke all on all functions in schema compi_private from public,anon;
grant execute on all functions in schema compi_private to authenticated;
revoke all on function public.compi_activate_access(),public.compi_staff_change(text,text,jsonb),public.compi_catalog_change(text,text,text,text,text) from public,anon;
grant execute on function public.compi_activate_access(),public.compi_staff_change(text,text,jsonb),public.compi_catalog_change(text,text,text,text,text) to authenticated;

insert into public.compi_memberships(user_id,hotel_key) values('ea6cf038-0010-4e1e-8fae-a0ecec9fcd6d','hotel-arts-barcelona');
insert into public.compi_staff(user_id,hotel_key,employee_name,email,position_name,outlet_name,access_rank)
select m.user_id,m.hotel_key,
 case u.email when 'ejecutivo-lab@compi.invalid' then 'Ejecutivo de prueba' when 'empleado-lab@compi.invalid' then 'Empleado de prueba' else 'Empleado externo de prueba' end,
 lower(u.email),case u.email when 'ejecutivo-lab@compi.invalid' then 'Chef Ejecutivo' else 'Chef de partida' end,
 case m.hotel_key when 'hotel-arts-barcelona' then 'Laboratorio Chefi' else 'Laboratorio externo' end,
 case u.email when 'ejecutivo-lab@compi.invalid' then 1 else 3 end
from public.compi_memberships m join auth.users u on u.id=m.user_id
where u.email in ('empleado-lab@compi.invalid','externo-lab@compi.invalid','ejecutivo-lab@compi.invalid');
;
