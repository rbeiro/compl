-- Isolated document catalog for the Claude edition. Memberships, sessions and hotel branding remain shared.

begin;

set local check_function_bodies = off;

set local search_path = public, pg_catalog;

create table public.compi_arts_guides (like public.compi_guides including all);

alter table public.compi_arts_guides enable row level security;

revoke all on public.compi_arts_guides from public, anon, authenticated;

grant select on public.compi_arts_guides to authenticated;

create table public.compi_arts_outlets (like public.compi_outlets including all);

alter table public.compi_arts_outlets enable row level security;

revoke all on public.compi_arts_outlets from public, anon, authenticated;

grant select on public.compi_arts_outlets to authenticated;

create table compi_private.arts_generated_drafts (like compi_private.generated_drafts including all);

alter table compi_private.arts_generated_drafts enable row level security;

revoke all on compi_private.arts_generated_drafts from public, anon, authenticated;

create table compi_private.arts_validated_files (like compi_private.validated_files including all);

alter table compi_private.arts_validated_files enable row level security;

revoke all on compi_private.arts_validated_files from public, anon, authenticated;

create table compi_private.arts_guide_sources (like compi_private.guide_sources including all);

alter table compi_private.arts_guide_sources enable row level security;

revoke all on compi_private.arts_guide_sources from public, anon, authenticated;

create table compi_private.arts_guide_classifications (like compi_private.guide_classifications including all);

alter table compi_private.arts_guide_classifications enable row level security;

revoke all on compi_private.arts_guide_classifications from public, anon, authenticated;

create table compi_private.arts_guide_costs (like compi_private.guide_costs including all);

alter table compi_private.arts_guide_costs enable row level security;

revoke all on compi_private.arts_guide_costs from public, anon, authenticated;

create table compi_private.arts_guide_reviews (like compi_private.guide_reviews including all);

alter table compi_private.arts_guide_reviews enable row level security;

revoke all on compi_private.arts_guide_reviews from public, anon, authenticated;

alter table public.compi_arts_guides add FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table compi_private.arts_generated_drafts add FOREIGN KEY (hotel_key, outlet_key, guide_key) REFERENCES compi_arts_guides(hotel_key, outlet_key, guide_key) ON DELETE CASCADE;

alter table compi_private.arts_validated_files add FOREIGN KEY (hotel_key, outlet_key, guide_key) REFERENCES compi_arts_guides(hotel_key, outlet_key, guide_key) ON DELETE CASCADE;

alter table compi_private.arts_guide_sources add FOREIGN KEY (hotel_key, outlet_key, guide_key) REFERENCES compi_arts_guides(hotel_key, outlet_key, guide_key) ON DELETE CASCADE;

alter table compi_private.arts_guide_classifications add FOREIGN KEY (hotel_key, outlet_key, guide_key) REFERENCES compi_arts_guides(hotel_key, outlet_key, guide_key) ON DELETE CASCADE;

alter table compi_private.arts_guide_costs add FOREIGN KEY (hotel_key, outlet_key, guide_key) REFERENCES compi_arts_guides(hotel_key, outlet_key, guide_key) ON DELETE CASCADE;

alter table compi_private.arts_guide_reviews add FOREIGN KEY (hotel_key, outlet_key, guide_key) REFERENCES compi_arts_guides(hotel_key, outlet_key, guide_key) ON DELETE CASCADE;

alter table compi_private.arts_guide_reviews add FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

create policy read_hotel_guides on public.compi_arts_guides for select to authenticated using ((select compi_private.active_download_session()) and (((compi_private.my_rank(hotel_key) >= 1) AND (compi_private.my_rank(hotel_key) <= 3)) AND (EXISTS ( SELECT 1
   FROM compi_arts_outlets o
  WHERE ((o.hotel_key = compi_arts_guides.hotel_key) AND (o.outlet_key = compi_arts_guides.outlet_key) AND (NOT o.archived)))) AND ((guide_state = 'ready'::text) OR ((guide_state = 'draft'::text) AND ((created_by = ( SELECT auth.uid() AS uid)) OR (compi_private.my_rank(hotel_key) = 1))))));

create policy hotel_outlets_read on public.compi_arts_outlets for select to authenticated using ((select compi_private.active_download_session()) and ((NOT archived) AND ((compi_private.my_rank(hotel_key) >= 1) AND (compi_private.my_rank(hotel_key) <= 3))));

create view compi_private.arts_workspace_sources as  SELECT s.hotel_key,
    s.outlet_key,
    s.guide_key,
    s.revision,
    s.source -> 'data'::text AS data,
        CASE
            WHEN ((s.source -> 'imagen_aprobada'::text) ->> 'tipo'::text) = ANY (ARRAY['foto'::text, 'acuarela'::text]) THEN (s.source -> 'imagen_aprobada'::text) ->> 'tipo'::text
            ELSE NULL::text
        END AS image_kind,
    (s.source -> 'imagen_aprobada'::text) ->> 'sha256'::text AS approved_sha,
        CASE
            WHEN ((s.source -> 'imagen_aprobada'::text) ->> 'tipo'::text) = 'acuarela'::text THEN ((s.source -> 'assets'::text) -> 'art'::text) ->> 'sha256'::text
            ELSE NULL::text
        END AS clean_sha
   FROM compi_private.arts_guide_sources s
     JOIN compi_private.arts_validated_files w ON w.hotel_key = s.hotel_key AND w.outlet_key = s.outlet_key AND w.guide_key = s.guide_key AND w.format = 'docx'::text AND w.digest = s.docx_sha
     JOIN compi_private.arts_validated_files p ON p.hotel_key = s.hotel_key AND p.outlet_key = s.outlet_key AND p.guide_key = s.guide_key AND p.format = 'pdf'::text AND p.digest = s.pdf_sha;

revoke all on compi_private.arts_workspace_sources from public, anon, authenticated;

CREATE OR REPLACE FUNCTION compi_private.arts_commit_file(h text, o text, g text, fmt text, sha text, previous text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare info jsonb; path text;
begin
 perform pg_advisory_xact_lock(hashtextextended(h,731));
 info:=compi_private.arts_file_access(h,o,g,fmt,true);
 if sha is null or sha !~ '^[a-f0-9]{64}$' then raise invalid_parameter_value; end if;
 if info->>'digest'=sha then return;end if;
 if info->>'digest' is distinct from previous then raise exception using errcode='PT409',message='El archivo ha cambiado. Vuelve a abrir la ficha.';end if;
 path:=(info->>'prefix')||'validated/'||sha||'/ficha.'||fmt;
 if not exists(select 1 from storage.objects where bucket_id='compi-arts-catalog' and name=path) then raise insufficient_privilege;end if;
 insert into compi_private.arts_validated_files values(h,o,g,fmt,sha)
 on conflict (hotel_key,outlet_key,guide_key,format) do update set digest=excluded.digest;
end $function$
;

revoke all on function compi_private.arts_commit_file(h text, o text, g text, fmt text, sha text, previous text) from public, anon, authenticated, service_role;

grant execute on function compi_private.arts_commit_file(h text, o text, g text, fmt text, sha text, previous text) to authenticated;

CREATE OR REPLACE FUNCTION compi_private.arts_file_access(h text, o text, g text, fmt text, editing boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare guide public.compi_arts_guides; rank smallint:=compi_private.my_rank(h); sha text;
begin
 if rank is null or fmt is null or fmt not in ('pdf','docx') or editing is null then raise insufficient_privilege;end if;
 select v.* into guide from public.compi_arts_guides v join public.compi_arts_outlets x using(hotel_key,outlet_key)
  where v.hotel_key=h and v.outlet_key=o and v.guide_key=g and not x.archived and
   (v.guide_state='ready' or (editing and v.guide_state='draft' and (rank=1 or v.created_by=auth.uid())));
 if not found or (editing and rank>2) then raise insufficient_privilege;end if;
 select f.digest into sha from compi_private.arts_validated_files f where (f.hotel_key,f.outlet_key,f.guide_key,f.format)=(h,o,g,fmt);
 return jsonb_build_object('prefix',guide.object_prefix,'digest',sha,'path',guide.object_prefix||
   case when sha is null then '' else 'validated/'||sha||'/' end||'ficha.'||fmt);
end $function$
;

revoke all on function compi_private.arts_file_access(h text, o text, g text, fmt text, editing boolean) from public, anon, authenticated, service_role;

grant execute on function compi_private.arts_file_access(h text, o text, g text, fmt text, editing boolean) to authenticated;

CREATE OR REPLACE FUNCTION compi_private.arts_catalog_change(h text, o text, g text, op text, label text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    select hotel into home_label from public.compi_arts_outlets where hotel_key=h limit 1;
    insert into public.compi_arts_outlets(hotel_key,outlet_key,hotel,outlet) values(h,newkey,coalesce(home_label,h),btrim(label));
    return newkey;
  end if;
  select hotel,outlet into home_label,folder_label from public.compi_arts_outlets where hotel_key=h and outlet_key=o and not archived for update;
  if not found then raise exception using errcode='PT404',message='Carpeta no disponible'; end if;
  if op='rename_folder' then
    update public.compi_arts_outlets set outlet=btrim(label) where hotel_key=h and outlet_key=o;
    update public.compi_arts_guides set outlet=btrim(label) where hotel_key=h and outlet_key=o;
  elsif op='delete_folder' then
    update public.compi_arts_outlets set archived=true where hotel_key=h and outlet_key=o;
  elsif op='new_guide' then
    insert into public.compi_arts_guides(hotel_key,outlet_key,guide_key,hotel,outlet,title,guide_state,created_by)
    values(h,o,newkey,home_label,folder_label,btrim(label),'draft',uid);
    return newkey;
  else
    select guide_state,created_by,object_prefix into state,who,prefix from public.compi_arts_guides
    where hotel_key=h and outlet_key=o and guide_key=g and guide_state<>'archived' for update;
    if not found or (state='draft' and who is distinct from uid and r<>1) then raise insufficient_privilege; end if;
    if op='rename_guide' then update public.compi_arts_guides set title=btrim(label) where hotel_key=h and outlet_key=o and guide_key=g;
    elsif op='delete_guide' then update public.compi_arts_guides set guide_state='archived' where hotel_key=h and outlet_key=o and guide_key=g;
    elsif op='publish' then
      if (select count(*) from compi_private.arts_validated_files f where (f.hotel_key,f.outlet_key,f.guide_key)=(h,o,g))<>2 then
        raise exception using errcode='PT409',message='Valida y sube tanto el Word como el PDF antes de publicar.'; end if;
      update public.compi_arts_guides set guide_state='ready' where hotel_key=h and outlet_key=o and guide_key=g;
    end if;
  end if;
  return coalesce(g,o);
end $function$
;

revoke all on function compi_private.arts_catalog_change(h text, o text, g text, op text, label text) from public, anon, authenticated, service_role;

grant execute on function compi_private.arts_catalog_change(h text, o text, g text, op text, label text) to authenticated;

CREATE OR REPLACE FUNCTION compi_private.arts_workspace_access(h text, o text, g text, writing boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare is_draft boolean;
begin
  if auth.uid() is null or not compi_private.active_download_session() then raise insufficient_privilege; end if;
  select r.guide_state='draft' into is_draft from public.compi_arts_guides r where (r.hotel_key,r.outlet_key,r.guide_key)=(h,o,g);
  if not found then raise insufficient_privilege; end if;
  perform compi_private.arts_file_access(h,o,g,'pdf',writing or is_draft);
  return is_draft;
end $function$
;

revoke all on function compi_private.arts_workspace_access(h text, o text, g text, writing boolean) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.compi_arts_catalog_change(h text, o text, g text, op text, label text)
 RETURNS text
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select compi_private.arts_catalog_change(h,o,g,op,label) $function$
;

revoke all on function public.compi_arts_catalog_change(h text, o text, g text, op text, label text) from public, anon, authenticated, service_role;

grant execute on function public.compi_arts_catalog_change(h text, o text, g text, op text, label text) to authenticated;

grant execute on function public.compi_arts_catalog_change(h text, o text, g text, op text, label text) to service_role;

CREATE OR REPLACE FUNCTION compi_private.arts_reserve_generated_draft(h text, o text, ticket uuid, label text, fingerprint text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare existing compi_private.arts_generated_drafts%rowtype; guide public.compi_arts_guides%rowtype; key text; uid uuid:=auth.uid();
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(h,731));
  if uid is null or not exists(select 1 from public.compi_arts_generator_outlet(h,o)) then raise insufficient_privilege; end if;
  if ticket is null or fingerprint is null or fingerprint !~ '^[0-9a-f]{64}$' then raise invalid_parameter_value; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text||ticket::text,912));
  select * into existing from compi_private.arts_generated_drafts d where d.author=uid and d.request_id=ticket;
  if found then
    if existing.hotel_key<>h or existing.outlet_key<>o or existing.fingerprint<>fingerprint then
      raise exception using errcode='PT409',message='Esta generación ya corresponde a otro borrador.';
    end if;
    key:=existing.guide_key;
  else
    key:=compi_private.arts_catalog_change(h,o,'','new_guide',label);
    insert into compi_private.arts_generated_drafts values(uid,ticket,h,o,key,fingerprint);
  end if;
  select * into strict guide from public.compi_arts_guides g where g.hotel_key=h and g.outlet_key=o and g.guide_key=key;
  if guide.guide_state<>'draft' then raise exception using errcode='PT409',message='El borrador ya se ha publicado o retirado.'; end if;
  return jsonb_build_object('key',key,'prefix',guide.object_prefix,
    'docx',exists(select 1 from compi_private.arts_validated_files f where (f.hotel_key,f.outlet_key,f.guide_key,f.format)=(h,o,key,'docx')),
    'pdf',exists(select 1 from compi_private.arts_validated_files f where (f.hotel_key,f.outlet_key,f.guide_key,f.format)=(h,o,key,'pdf')));
end $function$
;

revoke all on function compi_private.arts_reserve_generated_draft(h text, o text, ticket uuid, label text, fingerprint text) from public, anon, authenticated, service_role;

grant execute on function compi_private.arts_reserve_generated_draft(h text, o text, ticket uuid, label text, fingerprint text) to authenticated;

CREATE OR REPLACE FUNCTION compi_private.arts_save_guide_source(h text, o text, g text, source jsonb, docx text, pdf text, previous uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 old_source compi_private.arts_guide_sources%rowtype;
 asset record; approved jsonb:=source->'imagen_aprobada'; selected jsonb; route text; prefix text;
 snap uuid:=gen_random_uuid(); word_info jsonb; pdf_info jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(h,731));
 if auth.uid() is null or not exists(select 1 from public.compi_arts_generator_outlet(h,o)) then raise insufficient_privilege; end if;
 word_info:=compi_private.arts_file_access(h,o,g,'docx',true);
 pdf_info:=compi_private.arts_file_access(h,o,g,'pdf',true);
 if not exists(select 1 from public.compi_arts_guides r join compi_private.arts_generated_drafts d using(hotel_key,outlet_key,guide_key)
    where (r.hotel_key,r.outlet_key,r.guide_key)=(h,o,g) and r.guide_state='draft') then raise insufficient_privilege; end if;
 prefix:=word_info->>'prefix';
 if octet_length(source::text)>524288 or jsonb_typeof(source) is distinct from 'object'
   or jsonb_typeof(source->'data') is distinct from 'object' or jsonb_typeof(source->'media') is distinct from 'object'
   or jsonb_typeof(source->'assets') is distinct from 'object' or (source->'data' ? 'foto')
   or not coalesce((source->'data'->>'nombre_es') ~ '^[^/[:cntrl:]]{1,120}$',false)
 then raise invalid_parameter_value; end if;
 for asset in select * from jsonb_each(source->'assets') loop
   if asset.key not in ('original','photo','art','image') or not coalesce((asset.value->>'sha256') ~ '^[a-f0-9]{64}$',false)
   then raise invalid_parameter_value; end if;
   route:=prefix||'source/'||asset.key||'/'||(asset.value->>'sha256');
   if asset.value->>'ruta' is distinct from route or not exists(select 1 from storage.objects where bucket_id='compi-arts-media' and name=route)
   then raise invalid_parameter_value; end if;
 end loop;
 if source->'assets' ? 'photo' then
   if not coalesce(approved->>'tipo' in ('foto','acuarela'),false) then raise invalid_parameter_value; end if;
   selected:=source->'assets'->(case approved->>'tipo' when 'foto' then 'photo' else 'image' end);
   if selected is null or approved->>'sha256' is distinct from selected->>'sha256'
      or approved->>'ruta' is distinct from selected->>'ruta' then raise invalid_parameter_value; end if;
 elsif approved is distinct from 'null'::jsonb or source->'assets'<>'{}'::jsonb then raise invalid_parameter_value;
 end if;
 select * into old_source from compi_private.arts_guide_sources s where (s.hotel_key,s.outlet_key,s.guide_key)=(h,o,g);
 if found and old_source.source=source and old_source.docx_sha=docx and old_source.pdf_sha=pdf
   and word_info->>'digest'=docx and pdf_info->>'digest'=pdf then return old_source.revision; end if;
 if old_source.revision is distinct from previous or (old_source.revision is not null and
    (word_info->>'digest' is distinct from old_source.docx_sha or pdf_info->>'digest' is distinct from old_source.pdf_sha))
 then raise exception using errcode='PT409',message='El archivo ha cambiado. Vuelve a abrir la ficha.'; end if;
 perform compi_private.arts_commit_file(h,o,g,'docx',docx,word_info->>'digest');
 perform compi_private.arts_commit_file(h,o,g,'pdf',pdf,pdf_info->>'digest');
 insert into compi_private.arts_guide_sources values(h,o,g,snap,source,docx,pdf)
 on conflict(hotel_key,outlet_key,guide_key) do update set revision=excluded.revision,source=excluded.source,
 docx_sha=excluded.docx_sha,pdf_sha=excluded.pdf_sha;
 update public.compi_arts_guides set title=btrim(source->'data'->>'nombre_es') where (hotel_key,outlet_key,guide_key)=(h,o,g);
 return snap;
end $function$
;

revoke all on function compi_private.arts_save_guide_source(h text, o text, g text, source jsonb, docx text, pdf text, previous uuid) from public, anon, authenticated, service_role;

grant execute on function compi_private.arts_save_guide_source(h text, o text, g text, source jsonb, docx text, pdf text, previous uuid) to authenticated;

CREATE OR REPLACE FUNCTION compi_private.arts_guide_source(h text, o text, g text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare item compi_private.arts_guide_sources%rowtype;
begin
 if auth.uid() is null or not exists(select 1 from public.compi_arts_generator_outlet(h,o)) then raise insufficient_privilege; end if;
 perform compi_private.arts_file_access(h,o,g,'docx',true);
 select s.* into item from compi_private.arts_guide_sources s
 join compi_private.arts_validated_files w on (w.hotel_key,w.outlet_key,w.guide_key,w.format,w.digest)=(h,o,g,'docx',s.docx_sha)
 join compi_private.arts_validated_files p on (p.hotel_key,p.outlet_key,p.guide_key,p.format,p.digest)=(h,o,g,'pdf',s.pdf_sha)
 where (s.hotel_key,s.outlet_key,s.guide_key)=(h,o,g);
 if not found then return null; end if;
 return jsonb_build_object('revision',item.revision,'source',item.source);
end $function$
;

revoke all on function compi_private.arts_guide_source(h text, o text, g text) from public, anon, authenticated, service_role;

grant execute on function compi_private.arts_guide_source(h text, o text, g text) to authenticated;

CREATE OR REPLACE FUNCTION public.compi_arts_generator_outlet(h text, o text)
 RETURNS TABLE(hotel text, outlet text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select x.hotel,x.outlet from public.compi_arts_outlets x
  join public.compi_my_access() a on a.hotel_key=x.hotel_key
  where x.hotel_key=h and x.outlet_key=o and not x.archived and a.access_rank in (1,2)
    and compi_private.active_download_session()
$function$
;

revoke all on function public.compi_arts_generator_outlet(h text, o text) from public, anon, authenticated, service_role;

grant execute on function public.compi_arts_generator_outlet(h text, o text) to authenticated;

grant execute on function public.compi_arts_generator_outlet(h text, o text) to service_role;

CREATE OR REPLACE FUNCTION public.compi_arts_commit_file(h text, o text, g text, fmt text, sha text, previous text)
 RETURNS void
 LANGUAGE sql
 SET search_path TO ''
AS $function$select compi_private.arts_commit_file(h,o,g,fmt,sha,previous)$function$
;

revoke all on function public.compi_arts_commit_file(h text, o text, g text, fmt text, sha text, previous text) from public, anon, authenticated, service_role;

grant execute on function public.compi_arts_commit_file(h text, o text, g text, fmt text, sha text, previous text) to authenticated;

grant execute on function public.compi_arts_commit_file(h text, o text, g text, fmt text, sha text, previous text) to service_role;

CREATE OR REPLACE FUNCTION public.compi_arts_file_access(h text, o text, g text, fmt text, editing boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$select compi_private.arts_file_access(h,o,g,fmt,editing)$function$
;

revoke all on function public.compi_arts_file_access(h text, o text, g text, fmt text, editing boolean) from public, anon, authenticated, service_role;

grant execute on function public.compi_arts_file_access(h text, o text, g text, fmt text, editing boolean) to authenticated;

grant execute on function public.compi_arts_file_access(h text, o text, g text, fmt text, editing boolean) to service_role;

CREATE OR REPLACE FUNCTION public.compi_arts_guide_source(h text, o text, g text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$select compi_private.arts_guide_source(h,o,g)$function$
;

revoke all on function public.compi_arts_guide_source(h text, o text, g text) from public, anon, authenticated, service_role;

grant execute on function public.compi_arts_guide_source(h text, o text, g text) to authenticated;

grant execute on function public.compi_arts_guide_source(h text, o text, g text) to service_role;

CREATE OR REPLACE FUNCTION public.compi_arts_classify_guide(h text, o text, g text, kind text, category text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform pg_advisory_xact_lock(hashtextextended(h,731));
  perform compi_private.arts_workspace_access(h,o,g,true);
  if kind is not null and kind not in ('plato','elaboracion') or category is not null and category not in
    ('entrantes','principales','postres','fondos','salsas','bases','guarniciones','otros') then raise invalid_parameter_value; end if;
  insert into compi_private.arts_guide_classifications values(h,o,g,kind,category)
    on conflict(hotel_key,outlet_key,guide_key) do update set kind=excluded.kind,category=excluded.category;
end $function$
;

revoke all on function public.compi_arts_classify_guide(h text, o text, g text, kind text, category text) from public, anon, authenticated, service_role;

grant execute on function public.compi_arts_classify_guide(h text, o text, g text, kind text, category text) to authenticated;

grant execute on function public.compi_arts_classify_guide(h text, o text, g text, kind text, category text) to service_role;

CREATE OR REPLACE FUNCTION public.compi_arts_reserve_generated_draft(h text, o text, ticket uuid, label text, fingerprint text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select compi_private.arts_reserve_generated_draft(h,o,ticket,label,fingerprint)
$function$
;

revoke all on function public.compi_arts_reserve_generated_draft(h text, o text, ticket uuid, label text, fingerprint text) from public, anon, authenticated, service_role;

grant execute on function public.compi_arts_reserve_generated_draft(h text, o text, ticket uuid, label text, fingerprint text) to authenticated;

grant execute on function public.compi_arts_reserve_generated_draft(h text, o text, ticket uuid, label text, fingerprint text) to service_role;

CREATE OR REPLACE FUNCTION public.compi_arts_save_guide_source(h text, o text, g text, source jsonb, docx text, pdf text, previous uuid)
 RETURNS uuid
 LANGUAGE sql
 SET search_path TO ''
AS $function$select compi_private.arts_save_guide_source(h,o,g,source,docx,pdf,previous)$function$
;

revoke all on function public.compi_arts_save_guide_source(h text, o text, g text, source jsonb, docx text, pdf text, previous uuid) from public, anon, authenticated, service_role;

grant execute on function public.compi_arts_save_guide_source(h text, o text, g text, source jsonb, docx text, pdf text, previous uuid) to authenticated;

grant execute on function public.compi_arts_save_guide_source(h text, o text, g text, source jsonb, docx text, pdf text, previous uuid) to service_role;

CREATE OR REPLACE FUNCTION public.compi_arts_save_recipe_cost(h text, o text, g text, settings jsonb, previous uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare old compi_private.arts_guide_costs%rowtype; item jsonb; next_id uuid:=gen_random_uuid();
begin
  perform pg_advisory_xact_lock(hashtextextended(h,731));
  if compi_private.my_rank(h) is distinct from 1 then raise insufficient_privilege; end if;
  perform compi_private.arts_workspace_access(h,o,g,true);
  if settings is null or jsonb_typeof(settings)<>'object' or octet_length(settings::text)>96000
    or settings - array['servings','baseServings','salePrice','ingredients'] <> '{}'::jsonb
    or not compi_private.cost_number(settings->'servings',999,0,false) or not compi_private.cost_number(settings->'baseServings',999,0,false)
    or (settings->>'servings')::numeric<1 or (settings->>'baseServings')::numeric<1
    or not compi_private.cost_number(settings->'salePrice',99999.99,2,true)
    or jsonb_typeof(settings->'ingredients') is distinct from 'array'
  then raise invalid_parameter_value; end if;
  if jsonb_array_length(settings->'ingredients')>40 then raise invalid_parameter_value; end if;
  for item in select value from jsonb_array_elements(settings->'ingredients') loop
    if jsonb_typeof(item)<>'object' or item - array['name','quantity','unit','price','priceUnit'] <> '{}'::jsonb
      or jsonb_typeof(item->'name') is distinct from 'string' or length(btrim(item->>'name')) not between 1 and 120
      or jsonb_typeof(item->'unit') is distinct from 'string' or length(item->>'unit')>40
      or jsonb_typeof(item->'priceUnit') is distinct from 'string' or length(item->>'priceUnit')>40
      or not compi_private.cost_number(item->'quantity',999999.9999,4,true)
      or not compi_private.cost_number(item->'price',99999.9999,4,true)
    then raise invalid_parameter_value; end if;
  end loop;
  select * into old from compi_private.arts_guide_costs c where (c.hotel_key,c.outlet_key,c.guide_key)=(h,o,g);
  if old.settings=settings then return old.revision; end if;
  if old.revision is distinct from previous then raise exception using errcode='PT409',message='Los costes han cambiado. Vuelve a abrir el escandallo.'; end if;
  insert into compi_private.arts_guide_costs values(h,o,g,next_id,settings)
    on conflict (hotel_key,outlet_key,guide_key) do update set revision=excluded.revision,settings=excluded.settings;
  return next_id;
end $function$
;

revoke all on function public.compi_arts_save_recipe_cost(h text, o text, g text, settings jsonb, previous uuid) from public, anon, authenticated, service_role;

grant execute on function public.compi_arts_save_recipe_cost(h text, o text, g text, settings jsonb, previous uuid) to authenticated;

grant execute on function public.compi_arts_save_recipe_cost(h text, o text, g text, settings jsonb, previous uuid) to service_role;

CREATE OR REPLACE FUNCTION public.compi_arts_review_guide(h text, o text, g text, reviewed boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform pg_advisory_xact_lock(hashtextextended(h,731));
  perform compi_private.arts_workspace_access(h,o,g);
  if reviewed is null then raise invalid_parameter_value; end if;
  if reviewed then insert into compi_private.arts_guide_reviews values(auth.uid(),h,o,g) on conflict do nothing;
  else delete from compi_private.arts_guide_reviews v where (v.user_id,v.hotel_key,v.outlet_key,v.guide_key)=(auth.uid(),h,o,g); end if;
  return reviewed;
end $function$
;

revoke all on function public.compi_arts_review_guide(h text, o text, g text, reviewed boolean) from public, anon, authenticated, service_role;

grant execute on function public.compi_arts_review_guide(h text, o text, g text, reviewed boolean) to authenticated;

grant execute on function public.compi_arts_review_guide(h text, o text, g text, reviewed boolean) to service_role;

CREATE OR REPLACE FUNCTION public.compi_arts_recipe_cost(h text, o text, g text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare item compi_private.arts_guide_costs%rowtype; ingredients jsonb;
begin
  if compi_private.my_rank(h) is distinct from 1 then raise insufficient_privilege; end if;
  perform compi_private.arts_workspace_access(h,o,g);
  select * into item from compi_private.arts_guide_costs c where (c.hotel_key,c.outlet_key,c.guide_key)=(h,o,g);
  select compi_private.workspace_data(s.data)->'ingredientes' into ingredients from compi_private.arts_workspace_sources s
    where (s.hotel_key,s.outlet_key,s.guide_key)=(h,o,g);
  return jsonb_build_object('revision',item.revision,'settings',item.settings,'ingredientes',coalesce(ingredients,'[]'::jsonb));
end $function$
;

revoke all on function public.compi_arts_recipe_cost(h text, o text, g text) from public, anon, authenticated, service_role;

grant execute on function public.compi_arts_recipe_cost(h text, o text, g text) to authenticated;

grant execute on function public.compi_arts_recipe_cost(h text, o text, g text) to service_role;

CREATE OR REPLACE FUNCTION public.compi_arts_stage_guide_access(h text, o text, g text, fmt text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not exists(select 1 from public.compi_arts_generator_outlet(h,o))
    or not exists(select 1 from public.compi_arts_guides r where (r.hotel_key,r.outlet_key,r.guide_key)=(h,o,g) and r.guide_state='draft')
 then raise insufficient_privilege; end if;
 return compi_private.arts_file_access(h,o,g,fmt,true);
end $function$
;

revoke all on function public.compi_arts_stage_guide_access(h text, o text, g text, fmt text) from public, anon, authenticated, service_role;

grant execute on function public.compi_arts_stage_guide_access(h text, o text, g text, fmt text) to authenticated;

grant execute on function public.compi_arts_stage_guide_access(h text, o text, g text, fmt text) to service_role;

CREATE OR REPLACE FUNCTION public.compi_arts_workspace_media(h text, o text, g text, variant text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare is_draft boolean; item compi_private.arts_workspace_sources%rowtype; slot text; digest text;
begin
  is_draft:=compi_private.arts_workspace_access(h,o,g);
  if variant is null or variant not in ('approved','clean') then raise invalid_parameter_value; end if;
  select * into item from compi_private.arts_workspace_sources s where (s.hotel_key,s.outlet_key,s.guide_key)=(h,o,g);
  if variant='clean' then slot:='art'; digest:=item.clean_sha;
  else slot:=case item.image_kind when 'foto' then 'photo' when 'acuarela' then 'image' end; digest:=item.approved_sha; end if;
  if slot is null or digest is null or digest !~ '^[0-9a-f]{64}$' then return null; end if;
  return jsonb_build_object('slot',slot,'sha256',digest,'revision',item.revision,'draft',is_draft);
end $function$
;

revoke all on function public.compi_arts_workspace_media(h text, o text, g text, variant text) from public, anon, authenticated, service_role;

grant execute on function public.compi_arts_workspace_media(h text, o text, g text, variant text) to authenticated;

grant execute on function public.compi_arts_workspace_media(h text, o text, g text, variant text) to service_role;

CREATE OR REPLACE FUNCTION public.compi_arts_workspace_guide(h text, o text, g text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform compi_private.arts_workspace_access(h,o,g);
  return (select jsonb_build_object('data',compi_private.workspace_data(s.data),'has_image',s.approved_sha is not null,
    'image_kind',s.image_kind,'has_clean',s.clean_sha is not null)
    from compi_private.arts_workspace_sources s where (s.hotel_key,s.outlet_key,s.guide_key)=(h,o,g));
end $function$
;

revoke all on function public.compi_arts_workspace_guide(h text, o text, g text) from public, anon, authenticated, service_role;

grant execute on function public.compi_arts_workspace_guide(h text, o text, g text) to authenticated;

grant execute on function public.compi_arts_workspace_guide(h text, o text, g text) to service_role;

CREATE OR REPLACE FUNCTION public.compi_arts_workspace_catalog(after_h text DEFAULT ''::text, after_o text DEFAULT ''::text, after_g text DEFAULT ''::text, batch integer DEFAULT 200)
 RETURNS TABLE(hotel_key text, outlet_key text, guide_key text, hotel text, outlet text, title text, guide_state text, kind text, category text, reviewed boolean, can_classify boolean, has_source boolean, has_image boolean, image_kind text, has_clean boolean, partida text, racion text, pase text, sala_es text, nombre_en text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select r.hotel_key,r.outlet_key,r.guide_key,r.hotel,r.outlet,r.title,r.guide_state,c.kind,c.category,
    v.user_id is not null, a.access_rank in (1,2), s.revision is not null, s.approved_sha is not null,s.image_kind,s.clean_sha is not null,
    compi_private.workspace_text(s.data,'partida',80),compi_private.workspace_text(s.data,'racion',60),
    compi_private.workspace_text(s.data,'pase',60),compi_private.workspace_text(s.data,'sala_es',600),compi_private.workspace_text(s.data,'nombre_en',120)
  from public.compi_my_access() a
  join public.compi_arts_guides r on r.hotel_key=a.hotel_key
  join public.compi_arts_outlets f on (f.hotel_key,f.outlet_key)=(r.hotel_key,r.outlet_key) and not f.archived
  left join compi_private.arts_guide_classifications c on (c.hotel_key,c.outlet_key,c.guide_key)=(r.hotel_key,r.outlet_key,r.guide_key)
  left join compi_private.arts_guide_reviews v on (v.hotel_key,v.outlet_key,v.guide_key,v.user_id)=(r.hotel_key,r.outlet_key,r.guide_key,auth.uid())
  left join compi_private.arts_workspace_sources s on (s.hotel_key,s.outlet_key,s.guide_key)=(r.hotel_key,r.outlet_key,r.guide_key)
     and (r.guide_state='ready' or a.access_rank in (1,2))
  where a.access_rank in (1,2,3) and
    (r.guide_state='ready' or (r.guide_state='draft' and (a.access_rank=1 or r.created_by=auth.uid())))
    and (r.hotel_key,r.outlet_key,r.guide_key)>(after_h,after_o,after_g)
  order by r.hotel_key,r.outlet_key,r.guide_key limit greatest(1,least(200,batch))
$function$
;

revoke all on function public.compi_arts_workspace_catalog(after_h text, after_o text, after_g text, batch integer) from public, anon, authenticated, service_role;

grant execute on function public.compi_arts_workspace_catalog(after_h text, after_o text, after_g text, batch integer) to authenticated;

grant execute on function public.compi_arts_workspace_catalog(after_h text, after_o text, after_g text, batch integer) to service_role;

create policy compi_arts_proxy_only on storage.objects as restrictive for all to anon, authenticated using (bucket_id not in ('compi-arts-catalog','compi-arts-media')) with check (bucket_id not in ('compi-arts-catalog','compi-arts-media'));

notify pgrst, 'reload schema';

commit;
