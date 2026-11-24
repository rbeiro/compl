


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "compi_private";


ALTER SCHEMA "compi_private" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "compi_private"."active_download_session"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists(select 1 from auth.sessions s where s.id::text=auth.jwt()->>'session_id'
    and s.user_id=auth.uid() and (s.not_after is null or s.not_after>now()))
    and not public.compi_needs_mfa() and not compi_private.must_change_password()
$$;


ALTER FUNCTION "compi_private"."active_download_session"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."arts_catalog_change"("h" "text", "o" "text", "g" "text", "op" "text", "label" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
end $$;


ALTER FUNCTION "compi_private"."arts_catalog_change"("h" "text", "o" "text", "g" "text", "op" "text", "label" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."arts_commit_file"("h" "text", "o" "text", "g" "text", "fmt" "text", "sha" "text", "previous" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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
end $_$;


ALTER FUNCTION "compi_private"."arts_commit_file"("h" "text", "o" "text", "g" "text", "fmt" "text", "sha" "text", "previous" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."arts_file_access"("h" "text", "o" "text", "g" "text", "fmt" "text", "editing" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare guide public.compi_arts_guides; rank smallint:=compi_private.my_rank(h); sha text;
begin
 if rank is null or fmt is null or fmt not in ('pdf','docx') or editing is null then raise insufficient_privilege;end if;
 select v.* into guide from public.compi_arts_guides v join public.compi_arts_outlets x using(hotel_key,outlet_key)
  where v.hotel_key=h and v.outlet_key=o and v.guide_key=g and not x.archived and
   (v.guide_state='ready' or (editing and v.guide_state='draft' and (rank=1 or v.created_by=auth.uid())));
 if not found or (editing and rank>2) then raise insufficient_privilege;end if;
 select f.digest into sha from compi_private.arts_validated_files f where (f.hotel_key,f.outlet_key,f.guide_key,f.format)=(h,o,g,fmt);
 return jsonb_build_object('prefix',guide.object_prefix,'digest',sha,'drive_original',exists(select 1 from compi_private.arts_drive_originals a where (a.hotel_key,a.outlet_key,a.guide_key,a.format,a.digest)=(h,o,g,fmt,sha)),'path',guide.object_prefix||
   case when sha is null then '' else 'validated/'||sha||'/' end||'ficha.'||fmt);
end $$;


ALTER FUNCTION "compi_private"."arts_file_access"("h" "text", "o" "text", "g" "text", "fmt" "text", "editing" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."arts_guide_source"("h" "text", "o" "text", "g" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
end $$;


ALTER FUNCTION "compi_private"."arts_guide_source"("h" "text", "o" "text", "g" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."arts_reserve_generated_draft"("h" "text", "o" "text", "ticket" "uuid", "label" "text", "fingerprint" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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
end $_$;


ALTER FUNCTION "compi_private"."arts_reserve_generated_draft"("h" "text", "o" "text", "ticket" "uuid", "label" "text", "fingerprint" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."arts_save_guide_source"("h" "text", "o" "text", "g" "text", "source" "jsonb", "docx" "text", "pdf" "text", "previous" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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
end $_$;


ALTER FUNCTION "compi_private"."arts_save_guide_source"("h" "text", "o" "text", "g" "text", "source" "jsonb", "docx" "text", "pdf" "text", "previous" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."arts_workspace_access"("h" "text", "o" "text", "g" "text", "writing" boolean DEFAULT false) RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare is_draft boolean;
begin
  if auth.uid() is null or not compi_private.active_download_session() then raise insufficient_privilege; end if;
  select r.guide_state='draft' into is_draft from public.compi_arts_guides r where (r.hotel_key,r.outlet_key,r.guide_key)=(h,o,g);
  if not found then raise insufficient_privilege; end if;
  perform compi_private.arts_file_access(h,o,g,'pdf',writing or is_draft);
  return is_draft;
end $$;


ALTER FUNCTION "compi_private"."arts_workspace_access"("h" "text", "o" "text", "g" "text", "writing" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."can_write_file"("path" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
 select exists(select 1 from public.compi_guides g
  join public.compi_memberships m on m.hotel_key=g.hotel_key and m.user_id=(select auth.uid())
  where g.hotel_key=split_part(path,'/',1) and compi_private.my_rank(g.hotel_key) in (1,2)
  and path in (g.object_prefix||'ficha.docx',g.object_prefix||'ficha.pdf'));
$$;


ALTER FUNCTION "compi_private"."can_write_file"("path" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."catalog_change"("h" "text", "o" "text", "g" "text", "op" "text", "label" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "compi_private"."catalog_change"("h" "text", "o" "text", "g" "text", "op" "text", "label" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."commit_file"("h" "text", "o" "text", "g" "text", "fmt" "text", "sha" "text", "previous" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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
end $_$;


ALTER FUNCTION "compi_private"."commit_file"("h" "text", "o" "text", "g" "text", "fmt" "text", "sha" "text", "previous" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."compi_workspace_catalog"("after_h" "text" DEFAULT ''::"text", "after_o" "text" DEFAULT ''::"text", "after_g" "text" DEFAULT ''::"text", "batch" integer DEFAULT 200) RETURNS TABLE("hotel_key" "text", "outlet_key" "text", "guide_key" "text", "hotel" "text", "outlet" "text", "title" "text", "guide_state" "text", "kind" "text", "category" "text", "reviewed" boolean, "can_classify" boolean, "has_source" boolean, "has_image" boolean, "image_kind" "text", "has_clean" boolean, "partida" "text", "racion" "text", "pase" "text", "sala_es" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select r.hotel_key,r.outlet_key,r.guide_key,r.hotel,r.outlet,r.title,r.guide_state,c.kind,c.category,
    v.user_id is not null, a.access_rank in (1,2), s.revision is not null, s.approved_sha is not null,s.image_kind,s.clean_sha is not null,
    s.data->>'partida',s.data->>'racion',s.data->>'pase',s.data->>'sala_es'
  from public.compi_my_access() a
  join public.compi_guides r on r.hotel_key=a.hotel_key
  join public.compi_outlets f on (f.hotel_key,f.outlet_key)=(r.hotel_key,r.outlet_key) and not f.archived
  left join compi_private.guide_classifications c on (c.hotel_key,c.outlet_key,c.guide_key)=(r.hotel_key,r.outlet_key,r.guide_key)
  left join compi_private.guide_reviews v on (v.hotel_key,v.outlet_key,v.guide_key,v.user_id)=(r.hotel_key,r.outlet_key,r.guide_key,auth.uid())
  left join compi_private.workspace_sources s on (s.hotel_key,s.outlet_key,s.guide_key)=(r.hotel_key,r.outlet_key,r.guide_key)
     and (r.guide_state='ready' or a.access_rank in (1,2))
  where a.access_rank in (1,2,3) and
    (r.guide_state='ready' or (r.guide_state='draft' and (a.access_rank=1 or r.created_by=auth.uid())))
    and (r.hotel_key,r.outlet_key,r.guide_key)>(after_h,after_o,after_g)
  order by r.hotel_key,r.outlet_key,r.guide_key limit greatest(1,least(200,batch))
$$;


ALTER FUNCTION "compi_private"."compi_workspace_catalog"("after_h" "text", "after_o" "text", "after_g" "text", "batch" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."cost_number"("v" "jsonb", "maximum" numeric, "places" integer, "nullable" boolean) RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select case when v is null then false when jsonb_typeof(v)='null' then nullable
    when jsonb_typeof(v)<>'number' then false
    else (v::text)::numeric between 0 and maximum and (v::text)::numeric=round((v::text)::numeric,places) end
$$;


ALTER FUNCTION "compi_private"."cost_number"("v" "jsonb", "maximum" numeric, "places" integer, "nullable" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."delete_withdrawn_employee"("h" "text", "employee" "uuid", "withdrawal" timestamp with time zone) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare target public.compi_staff%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(h,731));
  if not compi_private.active_download_session() or compi_private.my_rank(h) is distinct from 1 then raise insufficient_privilege; end if;
  select * into target from public.compi_staff where hotel_key=h and id=employee for update;
  if not found then raise exception using errcode='PT404',message='Empleado no disponible en este hotel.'; end if;
  if target.withdrawn_at is null or target.withdrawn_at is distinct from withdrawal or
    exists(select 1 from public.compi_memberships where hotel_key=h and user_id=target.user_id) then
    raise exception using errcode='PT409',message='El acceso debe seguir retirado. Actualiza la lista.'; end if;
  delete from public.compi_staff where id=target.id;
  -- El usuario de acceso se borra solo si no pertenece a otro hotel; si algo lo referencia, se conserva sin error.
  if target.user_id is not null
     and not exists(select 1 from public.compi_staff where user_id=target.user_id)
     and not exists(select 1 from public.compi_memberships where user_id=target.user_id) then
    begin
      delete from auth.users where id=target.user_id;
    exception when foreign_key_violation then null;
    end;
  end if;
end $$;


ALTER FUNCTION "compi_private"."delete_withdrawn_employee"("h" "text", "employee" "uuid", "withdrawal" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."document_brand"("h" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare b compi_private.document_brands; factory compi_private.document_brand_defaults;
begin
  if compi_private.my_rank(h) is null then raise insufficient_privilege;end if;
  select * into b from compi_private.document_brands where hotel_key=h;
  select * into factory from compi_private.document_brand_defaults where hotel_key=h;
  return jsonb_build_object('accent',coalesce(b.accent,factory.accent,'46494A'),
    'logo_png',case when b.revision is not null then b.logo_png else factory.logo_png end,
    'revision',coalesce(b.revision,0),'configured',b.revision is not null);
end $$;


ALTER FUNCTION "compi_private"."document_brand"("h" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."document_brand_revision"("h" "text") RETURNS integer
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if compi_private.my_rank(h) is null then raise insufficient_privilege;end if;
  return coalesce((select revision from compi_private.document_brands where hotel_key=h),0);
end $$;


ALTER FUNCTION "compi_private"."document_brand_revision"("h" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."file_access"("h" "text", "o" "text", "g" "text", "fmt" "text", "editing" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "compi_private"."file_access"("h" "text", "o" "text", "g" "text", "fmt" "text", "editing" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."finish_lab_identity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare sid uuid; s public.compi_staff%rowtype; a uuid; t compi_private.lab_tickets%rowtype;
begin
 if tg_op='UPDATE' and old.email_confirmed_at is not null then
  if old.raw_app_meta_data->>'compi_lab_attempt' is distinct from new.raw_app_meta_data->>'compi_lab_attempt' then raise exception 'La cuenta ya estaba activa'; end if;
  return new;
 end if;
 a:=(new.raw_app_meta_data->>'compi_lab_attempt')::uuid;
 select employee into sid from compi_private.lab_tickets where attempt=a;
 select * into s from public.compi_staff where id=sid for update;
 select * into t from compi_private.lab_tickets where employee=sid for update;
 if s.id is null or t.attempt is distinct from a or t.lease_until<=clock_timestamp()
 or s.email<>lower(new.email) or new.email_confirmed_at is null or s.user_id is not null or s.withdrawn_at is not null
 or s.invite_state not in ('queued','issued','delivered') or s.invite_until<=clock_timestamp()
 then raise exception 'La invitación dejó de estar disponible'; end if;
 update public.compi_staff set user_id=new.id,invite_state='accepted' where id=sid;
 insert into public.compi_memberships(user_id,hotel_key) values(new.id,s.hotel_key) on conflict do nothing;
 delete from compi_private.lab_tickets where employee=sid;
 update compi_private.lab_mail_outbox set message=null,attempt=null,lease_until=null where employee=sid;
 return new;
end $$;


ALTER FUNCTION "compi_private"."finish_lab_identity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."finish_recovery"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not compi_private.has_lab_account(new.id) then raise insufficient_privilege; end if;
  delete from compi_private.backup_codes where owner=new.id and attempt::text=new.raw_app_meta_data->>'compi_recovery_attempt'
    and lease_until>clock_timestamp() and original_fingerprint is not null
    and original_fingerprint<>(select sha256(convert_to(u.encrypted_password,'UTF8')) from auth.users u where u.id=new.id);
  if not found then raise insufficient_privilege; end if;
  delete from auth.sessions where user_id=new.id;
  return new;
end $$;


ALTER FUNCTION "compi_private"."finish_recovery"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."guide_source"("h" "text", "o" "text", "g" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare item compi_private.guide_sources%rowtype;
begin
 if auth.uid() is null or not exists(select 1 from public.compi_generator_outlet(h,o)) then raise insufficient_privilege; end if;
 perform compi_private.file_access(h,o,g,'docx',true);
 select s.* into item from compi_private.guide_sources s
 join compi_private.validated_files w on (w.hotel_key,w.outlet_key,w.guide_key,w.format,w.digest)=(h,o,g,'docx',s.docx_sha)
 join compi_private.validated_files p on (p.hotel_key,p.outlet_key,p.guide_key,p.format,p.digest)=(h,o,g,'pdf',s.pdf_sha)
 where (s.hotel_key,s.outlet_key,s.guide_key)=(h,o,g);
 if not found then return null; end if;
 return jsonb_build_object('revision',item.revision,'source',item.source);
end $$;


ALTER FUNCTION "compi_private"."guide_source"("h" "text", "o" "text", "g" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."has_lab_account"("uid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists(select 1 from public.compi_staff s join public.compi_memberships m using(user_id,hotel_key)
   join auth.users u on u.id=s.user_id and lower(u.email)=s.email
   where s.user_id=uid and s.withdrawn_at is null and s.email like '%@compichef.com')
$$;


ALTER FUNCTION "compi_private"."has_lab_account"("uid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."lab_invitee"("h" "text", "employee" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare address text;
begin
  if not compi_private.active_download_session() or compi_private.my_rank(h) is distinct from 1 then
    raise insufficient_privilege;
  end if;
  select s.email into address from public.compi_staff s
   where s.id = employee and s.hotel_key = h and s.user_id is null and s.withdrawn_at is null
     and s.email ~ '^[a-z0-9._+-]+@compichef[.]com$'
     and not exists (select 1 from auth.users u where lower(u.email)=s.email
                     and (u.email_confirmed_at is not null or u.invited_at is null));
  if address is null then
    raise exception using errcode='PT409',message='La invitación requiere una cuenta de prueba pendiente.';
  end if;
  return address;
end $_$;


ALTER FUNCTION "compi_private"."lab_invitee"("h" "text", "employee" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."mail_change"("h" "text", "op" "text", "data" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare member public.compi_staff%rowtype; msg compi_private.mail_items%rowtype; mid uuid; fid uuid;
  folder_name text; dest text; subj text; content text; addresses text[]; recipients_ids uuid[]; changed int;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(h,731));
  member:=compi_private.mail_owner(h);
  if op='folder_create' then
    folder_name:=btrim(data->>'label');
    if coalesce(length(folder_name),0) not between 1 and 60 or folder_name ~ '[[:cntrl:]]' or
      lower(folder_name) in ('entrada','buzón de entrada','bandeja de entrada','enviados','correos enviados','borradores','favoritos') then
      raise exception using errcode='22023',message='Elige un nombre de carpeta distinto de las bandejas base (1–60 caracteres).';
    end if;
    insert into compi_private.mail_folders(owner,label) values(member.id,folder_name) returning id into fid;
    return jsonb_build_object('id',fid);
  elsif op='folder_delete' then
    delete from compi_private.mail_folders f where f.owner=member.id and f.id::text=data->>'folder';
    if not found then raise exception using errcode='PT404',message='Solo puedes eliminar una carpeta personal propia.'; end if;
    return '{}';
  end if;
  mid:=(data->>'id')::uuid;
  if mid is null then raise invalid_parameter_value; end if;
  select * into msg from compi_private.mail_items m where m.owner=member.id and m.id=mid for update;
  if op in ('save','send') then
    dest:=btrim(coalesce(data->>'to','')); subj:=btrim(coalesce(data->>'subject','')); content:=coalesce(data->>'body','');
    if length(dest)>1500 or length(subj)>200 or length(content)>30000 then
      raise exception using errcode='22023',message='El correo supera la longitud permitida.'; end if;
    if msg.origin='sent' and op='send' then return jsonb_build_object('id',mid,'sent',true); end if;
    if msg.id is not null and msg.origin<>'drafts' then raise insufficient_privilege; end if;
    if msg.id is not null and msg.revision is distinct from (data->>'revision')::int then
      if op='save' and (msg.recipients,msg.subject,msg.body)=(dest,subj,content) then
        return jsonb_build_object('id',mid,'revision',msg.revision); end if;
      raise exception using errcode='PT409',message='El borrador cambió en otra pestaña. Ábrelo de nuevo antes de guardar.';
    end if;
    if msg.id is null and coalesce((data->>'revision')::int,0)<>0 then
      raise exception using errcode='PT409',message='El borrador ya no está disponible.'; end if;
    if op='send' then
      if nullif(subj,'') is null or nullif(btrim(content),'') is null or dest='' then
        raise exception using errcode='22023',message='Completa destinatario, asunto y mensaje.'; end if;
      select array_agg(distinct lower(btrim(a)) order by lower(btrim(a))) into addresses from regexp_split_to_table(dest,'[,;]') a;
      if cardinality(addresses)>12 or exists(select 1 from unnest(addresses) a where a !~ '^[a-z0-9._+-]+@compichef[.]com$') then
        raise exception using errcode='22023',message='Usa hasta 12 direcciones internas @compichef.com, separadas por comas.'; end if;
      select array_agg(s.id) into recipients_ids from public.compi_staff s join public.compi_memberships m using(user_id,hotel_key)
        where s.hotel_key=h and s.withdrawn_at is null and s.email=any(addresses);
      if coalesce(cardinality(recipients_ids),0)<>cardinality(addresses) then
        raise exception using errcode='22023',message='Hay un destinatario sin buzón activo en este hotel. Revisa las direcciones.'; end if;
      dest:=array_to_string(addresses,', ');
    end if;
    insert into compi_private.mail_items as existing(owner,id,origin,sender,recipients,subject,body)
      values(member.id,mid,case when op='send' then 'sent' else 'drafts' end,member.email,dest,subj,content)
      on conflict(owner,id) do update set origin=excluded.origin,recipients=excluded.recipients,subject=excluded.subject,
        body=excluded.body,updated_at=clock_timestamp(),revision=existing.revision+1,
        folder=case when op='send' then null else existing.folder end returning revision into changed;
    if op='send' then
      insert into compi_private.mail_items(owner,origin,sender,recipients,subject,body,unread)
        select a,'inbox',member.email,dest,subj,content,true from unnest(recipients_ids) a;
    end if;
    return jsonb_build_object('id',mid,'revision',changed,'sent',op='send');
  end if;
  if msg.id is null then raise exception using errcode='PT404',message='Correo no disponible.'; end if;
  if op='star' then
    update compi_private.mail_items set starred=(data->>'value')::boolean where owner=member.id and id=mid;
  elsif op='read' then
    update compi_private.mail_items set unread=false where owner=member.id and id=mid;
  elsif op='move' then
    fid:=(data->>'folder')::uuid;
    if fid is not null and not exists (select 1 from compi_private.mail_folders f where f.owner=member.id and f.id=fid) then
      raise exception using errcode='PT404',message='Carpeta no disponible.'; end if;
    update compi_private.mail_items set folder=fid where owner=member.id and id=mid;
  else raise invalid_parameter_value; end if;
  return '{}';
end $_$;


ALTER FUNCTION "compi_private"."mail_change"("h" "text", "op" "text", "data" "jsonb") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."compi_staff" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "hotel_key" "text" NOT NULL,
    "user_id" "uuid",
    "email" "text" NOT NULL,
    "employee_name" "text" NOT NULL,
    "position_name" "text" NOT NULL,
    "outlet_name" "text" NOT NULL,
    "access_rank" smallint DEFAULT 3 NOT NULL,
    "withdrawn_at" timestamp with time zone,
    "invite_state" "text",
    "invite_until" timestamp with time zone,
    "invite_revision" "uuid",
    CONSTRAINT "compi_staff_access_rank_check" CHECK (("access_rank" = ANY (ARRAY[1, 2, 3]))),
    CONSTRAINT "compi_staff_email_check" CHECK ((("email" = "lower"("btrim"("email"))) AND (("length"("email") >= 3) AND ("length"("email") <= 254)))),
    CONSTRAINT "compi_staff_employee_name_check" CHECK ((("length"("btrim"("employee_name")) >= 1) AND ("length"("btrim"("employee_name")) <= 120))),
    CONSTRAINT "compi_staff_outlet_name_check" CHECK ((("length"("btrim"("outlet_name")) >= 1) AND ("length"("btrim"("outlet_name")) <= 120))),
    CONSTRAINT "compi_staff_position_name_check" CHECK ((("length"("btrim"("position_name")) >= 1) AND ("length"("btrim"("position_name")) <= 120)))
);


ALTER TABLE "public"."compi_staff" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."mail_owner"("h" "text") RETURNS "public"."compi_staff"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare member public.compi_staff%rowtype;
begin
  select s.* into member from public.compi_staff s join public.compi_memberships m using(user_id,hotel_key)
  where s.hotel_key=h and s.user_id=(select auth.uid()) and s.withdrawn_at is null
    and s.email ~ '^[a-z0-9._+-]+@compichef[.]com$' and compi_private.active_download_session();
  if not found then raise insufficient_privilege; end if;
  return member;
end $_$;


ALTER FUNCTION "compi_private"."mail_owner"("h" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."mail_read"("h" "text", "box" "text", "p" integer, "item" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare member public.compi_staff:=compi_private.mail_owner(h); folders jsonb; entries jsonb; detail jsonb; custom uuid;
begin
  if p is null or p<0 or p>1000000 or box is null then raise invalid_parameter_value; end if;
  if box not in ('inbox','sent','drafts','starred') then
    select f.id into custom from compi_private.mail_folders f where f.owner=member.id and f.id::text=box;
    if not found then raise exception using errcode='PT404',message='Carpeta no disponible.'; end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'label',f.label) order by lower(f.label)), '[]') into folders
    from compi_private.mail_folders f where f.owner=member.id;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.updated_at desc,q.id),'[]') into entries from (
    select m.id,m.origin,m.folder,m.starred,m.unread,m.sender,m.recipients,m.subject,m.updated_at,left(m.body,125) as snippet
    from compi_private.mail_items m where m.owner=member.id and
      ((box='starred' and m.starred) or m.folder=custom or (m.folder is null and m.origin=box))
    order by m.updated_at desc,m.id offset p*40 limit 41
  ) q;
  if item is not null then
    select to_jsonb(m)-'owner' into detail from compi_private.mail_items m where m.owner=member.id and m.id=item;
    if not found then raise exception using errcode='PT404',message='Correo no disponible.'; end if;
  end if;
  return jsonb_build_object('address',member.email,'folders',folders,'entries',entries,'item',detail);
end $$;


ALTER FUNCTION "compi_private"."mail_read"("h" "text", "box" "text", "p" integer, "item" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."minimize_allocation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin update compi_private.address_allocations set submitted=null,registrar=null,hotel=null where request_id=old.id; return old; end $$;


ALTER FUNCTION "compi_private"."minimize_allocation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."must_change_password"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$ select coalesce((select u.raw_app_meta_data->>'compi_must_change' = 'true' from auth.users u where u.id = auth.uid()), false) $$;


ALTER FUNCTION "compi_private"."must_change_password"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."my_rank"("h" "text") RETURNS smallint
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select s.access_rank from public.compi_staff s join public.compi_memberships m using(user_id,hotel_key)
   where s.hotel_key=h and s.user_id=(select auth.uid()) and s.withdrawn_at is null
     and (select compi_private.active_download_session())
$$;


ALTER FUNCTION "compi_private"."my_rank"("h" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."personal_backup"("issue" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "compi_private"."personal_backup"("issue" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."record_staff_event"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare kind text;
begin
 if tg_op='INSERT' then kind:='registered';
 elsif tg_op='DELETE' then kind:='deleted';
 elsif old.access_rank is distinct from new.access_rank then kind:='rank_changed';
 elsif old.withdrawn_at is distinct from new.withdrawn_at then kind:=case when new.withdrawn_at is null then 'restored' else 'withdrawn' end;
 elsif old.invite_state is distinct from new.invite_state then kind:='invitation_'||coalesce(new.invite_state,'pending');
 else return null;end if;
 insert into compi_private.access_events(hotel,actor,employee,event)
 values(coalesce(new.hotel_key,old.hotel_key),auth.uid(),coalesce(new.id,old.id),kind);
 delete from compi_private.access_events where occurred_at<now()-interval '90 days';
 return null;
end $$;


ALTER FUNCTION "compi_private"."record_staff_event"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."register_address"("h" "text", "request_id" "uuid", "given_name" "text", "surname" "text", "position_name" "text", "outlet_name" "text", "access_rank" smallint) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  given text := regexp_replace(lower(pg_catalog.normalize(btrim(given_name),'NFKD')),'[^a-z]','','g');
  family text := regexp_replace(lower(pg_catalog.normalize(btrim(surname),'NFKD')),'[^a-z]','','g');
  full_name text := concat_ws(' ',btrim(given_name),btrim(surname));
  submitted jsonb := jsonb_build_array(full_name,position_name,outlet_name,access_rank);
  existing compi_private.address_allocations%rowtype;
  letters text; stem text; suffix text; candidate text; step int:=1; hcode text;
begin
  if not compi_private.active_download_session() or compi_private.my_rank(h) is distinct from 1 then raise insufficient_privilege; end if;
  if request_id is null or coalesce(given,'')='' or coalesce(family,'')='' or length(full_name)>120 or
     coalesce(length(btrim(position_name)),0) not between 1 and 120 or coalesce(length(btrim(outlet_name)),0) not between 1 and 120 or
     access_rank is null or access_rank not between 1 and 3 then
    raise exception using errcode='22023',message='Revisa el nombre, el apellido, el puesto, el outlet y el rango.';
  end if;
  select c.code into hcode from compi_private.hotel_codes c where c.hotel_key=h;
  if hcode is null then raise exception using errcode='22023',message='Este hotel no tiene código de correo.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('compi.corporate.addresses',14));
  select a.* into existing from compi_private.address_allocations a where a.request_id=register_address.request_id;
  if found then
    if existing.registrar is distinct from auth.uid() or existing.hotel is distinct from h or existing.submitted is distinct from submitted then raise insufficient_privilege; end if;
    return existing.address;
  end if;
  -- After the initial, prefer consonants in name order (Eustaquio -> es -> est).
  letters:=left(given,1)||regexp_replace(substr(given,2),'[aeiou]','','g')||regexp_replace(substr(given,2),'[^aeiou]','','g');
  family:=left(family,36); letters:=left(letters,12);
  loop
    stem:=left(letters,step);
    suffix:=case when step>length(letters) then (step-length(letters)+1)::text else '' end;
    candidate:=stem||suffix||'.'||family||'.'||hcode||'@compichef.com';
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


ALTER FUNCTION "compi_private"."register_address"("h" "text", "request_id" "uuid", "given_name" "text", "surname" "text", "position_name" "text", "outlet_name" "text", "access_rank" smallint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."remove_pending_employee"("h" "text", "employee" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare target public.compi_staff%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(h,731));
  if not compi_private.active_download_session() or compi_private.my_rank(h) is distinct from 1 then raise insufficient_privilege; end if;
  select * into target from public.compi_staff where hotel_key=h and id=employee for update;
  if not found then raise exception using errcode='PT404',message='Empleado no disponible en este hotel.'; end if;
  if target.user_id is not null or target.withdrawn_at is not null then
    raise exception using errcode='PT409',message='El empleado ya tiene cuenta. Actualiza la lista.'; end if;
  if exists(select 1 from auth.users u where lower(u.email)=target.email) then
    raise exception using errcode='PT409',message='Ya existe una cuenta con ese correo. Actualiza la lista.'; end if;
  delete from compi_private.lab_tickets t where t.employee=target.id;
  delete from compi_private.lab_mail_outbox o where o.employee=target.id;
  delete from compi_private.address_allocations where request_id=target.id;
  delete from public.compi_staff where id=target.id;
end $$;


ALTER FUNCTION "compi_private"."remove_pending_employee"("h" "text", "employee" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."reserve_generated_draft"("h" "text", "o" "text", "ticket" "uuid", "label" "text", "fingerprint" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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
end $_$;


ALTER FUNCTION "compi_private"."reserve_generated_draft"("h" "text", "o" "text", "ticket" "uuid", "label" "text", "fingerprint" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."save_guide_source"("h" "text", "o" "text", "g" "text", "source" "jsonb", "docx" "text", "pdf" "text", "previous" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
 old_source compi_private.guide_sources%rowtype;
 asset record; approved jsonb:=source->'imagen_aprobada'; selected jsonb; route text; prefix text;
 snap uuid:=gen_random_uuid(); word_info jsonb; pdf_info jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(h,731));
 if auth.uid() is null or not exists(select 1 from public.compi_generator_outlet(h,o)) then raise insufficient_privilege; end if;
 word_info:=compi_private.file_access(h,o,g,'docx',true);
 pdf_info:=compi_private.file_access(h,o,g,'pdf',true);
 if not exists(select 1 from public.compi_guides r join compi_private.generated_drafts d using(hotel_key,outlet_key,guide_key)
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
   if asset.value->>'ruta' is distinct from route or not exists(select 1 from storage.objects where bucket_id='compi-guide-media' and name=route)
   then raise invalid_parameter_value; end if;
 end loop;
 if source->'assets' ? 'photo' then
   if not coalesce(approved->>'tipo' in ('foto','acuarela'),false) then raise invalid_parameter_value; end if;
   selected:=source->'assets'->(case approved->>'tipo' when 'foto' then 'photo' else 'image' end);
   if selected is null or approved->>'sha256' is distinct from selected->>'sha256'
      or approved->>'ruta' is distinct from selected->>'ruta' then raise invalid_parameter_value; end if;
 elsif approved is distinct from 'null'::jsonb or source->'assets'<>'{}'::jsonb then raise invalid_parameter_value;
 end if;
 select * into old_source from compi_private.guide_sources s where (s.hotel_key,s.outlet_key,s.guide_key)=(h,o,g);
 if found and old_source.source=source and old_source.docx_sha=docx and old_source.pdf_sha=pdf
   and word_info->>'digest'=docx and pdf_info->>'digest'=pdf then return old_source.revision; end if;
 if old_source.revision is distinct from previous or (old_source.revision is not null and
    (word_info->>'digest' is distinct from old_source.docx_sha or pdf_info->>'digest' is distinct from old_source.pdf_sha))
 then raise exception using errcode='PT409',message='El archivo ha cambiado. Vuelve a abrir la ficha.'; end if;
 perform compi_private.commit_file(h,o,g,'docx',docx,word_info->>'digest');
 perform compi_private.commit_file(h,o,g,'pdf',pdf,pdf_info->>'digest');
 insert into compi_private.guide_sources values(h,o,g,snap,source,docx,pdf)
 on conflict(hotel_key,outlet_key,guide_key) do update set revision=excluded.revision,source=excluded.source,
 docx_sha=excluded.docx_sha,pdf_sha=excluded.pdf_sha;
 update public.compi_guides set title=btrim(source->'data'->>'nombre_es') where (hotel_key,outlet_key,guide_key)=(h,o,g);
 return snap;
end $_$;


ALTER FUNCTION "compi_private"."save_guide_source"("h" "text", "o" "text", "g" "text", "source" "jsonb", "docx" "text", "pdf" "text", "previous" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."schedule_balance"("h" "text", "employee_id" "uuid", "month_start" "date", "adjustment" integer, "previous" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare me public.compi_staff:=compi_private.schedule_member(h); old_balance compi_private.schedule_hours;
begin
 if me.access_rank<>1 then raise insufficient_privilege;end if;
 perform 1 from public.compi_staff where id=employee_id and hotel_key=h and withdrawn_at is null for update;
 if not found then raise insufficient_privilege;end if;
 if month_start is null or extract(day from month_start)<>1 or adjustment is null then raise invalid_parameter_value;end if;
 select * into old_balance from compi_private.schedule_hours where employee=employee_id and month=month_start;
 if coalesce(old_balance.minutes,0)=adjustment then return;end if;
 if old_balance.revision is distinct from previous then raise exception using errcode='PT409',message='El saldo ha cambiado. Revisa la tabla actualizada.';end if;
 insert into compi_private.schedule_hours(employee,month,minutes) values(employee_id,month_start,adjustment)
 on conflict(employee,month) do update set minutes=excluded.minutes,revision=gen_random_uuid();
end $$;


ALTER FUNCTION "compi_private"."schedule_balance"("h" "text", "employee_id" "uuid", "month_start" "date", "adjustment" integer, "previous" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."schedule_decide"("h" "text", "request_id" "uuid", "decision" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare me public.compi_staff:=compi_private.schedule_member(h); item compi_private.schedule_leave;
begin
 if me.access_rank<>1 then raise insufficient_privilege;end if;
 if decision is null or decision not in ('approved','rejected') then raise invalid_parameter_value;end if;
 perform 1 from public.compi_staff s join compi_private.schedule_leave l on l.employee=s.id where l.id=request_id and s.hotel_key=h and s.withdrawn_at is null for update of s;
 if not found then raise insufficient_privilege;end if;
 select * into item from compi_private.schedule_leave where id=request_id for update;
 if item.state=decision then return;end if;
 if item.state<>'pending' then raise exception using errcode='PT409',message='Esta solicitud ya tiene una decisión.';end if;
 update compi_private.schedule_leave set state=decision,decided_at=now(),decided_by=me.id where id=request_id;
end $$;


ALTER FUNCTION "compi_private"."schedule_decide"("h" "text", "request_id" "uuid", "decision" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."schedule_edit"("h" "text", "employee_id" "uuid", "work_day" "date", "kind" "text", "start_time" time without time zone, "end_time" time without time zone, "previous" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare me public.compi_staff:=compi_private.schedule_member(h); old_shift compi_private.schedule_shifts;
begin
 if me.access_rank<>1 then raise insufficient_privilege;end if;
 perform 1 from public.compi_staff where id=employee_id and hotel_key=h and withdrawn_at is null for update;
 if not found then raise insufficient_privilege;end if;
 if work_day is null or kind is null or kind not in ('work','off','clear') then raise invalid_parameter_value;end if;
 if kind='work' and (start_time is null or end_time is null or start_time=end_time) then raise exception using errcode='22023',message='Introduce una hora de entrada y otra de salida distintas.';end if;
 if kind<>'work' then start_time:=null;end_time:=null;end if;
 if exists(select 1 from compi_private.schedule_leave l where l.employee=employee_id and l.state='approved' and work_day=any(l.days))
   then raise exception using errcode='PT409',message='El empleado tiene vacaciones aprobadas para ese día.';end if;
 select * into old_shift from compi_private.schedule_shifts where employee=employee_id and day=work_day;
 if (old_shift.kind,old_shift.starts,old_shift.ends) is not distinct from (kind,start_time,end_time) or (old_shift.employee is null and kind='clear') then return;end if;
 if old_shift.revision is distinct from previous then raise exception using errcode='PT409',message='El turno ha cambiado. Revisa el cuadrante actualizado.';end if;
 if kind='clear' then delete from compi_private.schedule_shifts where employee=employee_id and day=work_day;
 else insert into compi_private.schedule_shifts(employee,day,kind,starts,ends) values(employee_id,work_day,kind,start_time,end_time)
  on conflict(employee,day) do update set kind=excluded.kind,starts=excluded.starts,ends=excluded.ends,revision=gen_random_uuid();
 end if;
end $$;


ALTER FUNCTION "compi_private"."schedule_edit"("h" "text", "employee_id" "uuid", "work_day" "date", "kind" "text", "start_time" time without time zone, "end_time" time without time zone, "previous" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."schedule_member"("h" "text") RETURNS "public"."compi_staff"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare me public.compi_staff;
begin
 select s.* into me from public.compi_staff s join public.compi_memberships m using(hotel_key,user_id)
 where s.hotel_key=h and s.user_id=auth.uid() and s.withdrawn_at is null and compi_private.active_download_session();
 if not found then raise insufficient_privilege;end if;
 return me;
end $$;


ALTER FUNCTION "compi_private"."schedule_member"("h" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."schedule_request"("h" "text", "request_id" "uuid", "requested" "date"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare me public.compi_staff:=compi_private.schedule_member(h); chosen date[]; existing compi_private.schedule_leave;
begin
 perform 1 from public.compi_staff where id=me.id and withdrawn_at is null for update;
 if not found then raise insufficient_privilege;end if;
 select array_agg(distinct d order by d) into chosen from unnest(requested) d;
 if request_id is null or coalesce(cardinality(chosen),0)=0 or array_position(chosen,null::date) is not null then raise invalid_parameter_value;end if;
 select * into existing from compi_private.schedule_leave where id=request_id;
 if found then
  if existing.employee=me.id and existing.days=chosen then return;end if;
  raise insufficient_privilege;
 end if;
 if exists(select 1 from compi_private.schedule_leave where employee=me.id and state<>'rejected' and days && chosen) then
  raise exception using errcode='PT409',message='Hay días que ya has solicitado. Revisa la selección.';end if;
 if exists(with all_days as (select d from unnest(chosen) d union all
   select d from compi_private.schedule_leave l cross join lateral unnest(l.days) d where l.employee=me.id and l.state<>'rejected')
   select 1 from all_days group by extract(year from d) having count(*)>45) then
  raise exception using errcode='22023',message='La selección supera los 45 días disponibles en un año.';end if;
 insert into compi_private.schedule_leave(id,employee,days) values(request_id,me.id,chosen);
end $$;


ALTER FUNCTION "compi_private"."schedule_request"("h" "text", "request_id" "uuid", "requested" "date"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."schedule_view"("h" "text", "month_start" "date", "department" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  me public.compi_staff:=compi_private.schedule_member(h);
  dep text:=lower(trim(coalesce(department,me.outlet_name)));
  until_day date:=(month_start+interval '1 month')::date;
  result jsonb;
begin
  if month_start is null or extract(day from month_start)<>1 then raise invalid_parameter_value;end if;
  if me.access_rank<>1 and dep<>lower(trim(me.outlet_name)) and not exists (
    select 1 from compi_private.schedule_extra_outlets e
    join public.compi_outlets o using (hotel_key,outlet_key)
    where e.employee=me.id and e.hotel_key=h and not o.archived and lower(trim(o.outlet))=dep
  ) then raise insufficient_privilege;end if;

  with team as materialized (
    select s.id,s.employee_name as name,s.position_name as position,s.access_rank as rank,trim(s.outlet_name) as department
    from public.compi_staff s where s.hotel_key=h and s.withdrawn_at is null
  ), assignments as materialized (
    select t.id,t.department from team t
    union
    select t.id,trim(o.outlet) from team t
    join compi_private.schedule_extra_outlets e on e.employee=t.id and e.hotel_key=h
    join public.compi_outlets o using (hotel_key,outlet_key) where not o.archived
  ), roster as materialized (
    select t.* from team t
    where exists (select 1 from assignments a where a.id=t.id and lower(a.department)=dep)
      and lower(trim(t.position)) not in ('chef ejecutivo','chef ejecutiva','executive chef')
  ), balances as (
    select t.id,t.name,t.position,t.rank,t.department,coalesce(sum(b.minutes),0) as total,
      coalesce(max(b.minutes) filter(where b.month=month_start),0) as adjustment,
      max(b.revision::text) filter(where b.month=month_start) as revision
    from team t left join compi_private.schedule_hours b on b.employee=t.id and b.month<=month_start
    where me.access_rank=1 or t.id=me.id group by t.id,t.name,t.position,t.rank,t.department
  )
  select jsonb_build_object(
    'me',me.id,'admin',me.access_rank=1,'dept',dep,
    'departments',(select jsonb_agg(to_jsonb(d) order by d.name) from (
      select lower(a.department) as key,min(a.department) as name from assignments a
      where me.access_rank=1 or a.id=me.id group by lower(a.department)
    ) d),
    'people',coalesce((select jsonb_agg(to_jsonb(r)) from roster r),'[]'),
    'shifts',coalesce((select jsonb_agg(to_jsonb(s)) from compi_private.schedule_shifts s join roster r on r.id=s.employee where s.day>=month_start and s.day<until_day),'[]'),
    'vacations',coalesce((select jsonb_agg(jsonb_build_object('employee',l.employee,'day',v)) from compi_private.schedule_leave l join roster r on r.id=l.employee
      cross join lateral unnest(l.days) v where l.state='approved' and v>=month_start and v<until_day),'[]'),
    'balances',coalesce((select jsonb_agg(to_jsonb(b)) from balances b),'[]'),
    'mine',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'days',l.days,'state',l.state) order by l.created_at desc) from compi_private.schedule_leave l where l.employee=me.id),'[]'),
    'requests',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'name',t.name,'department',t.department,'days',l.days,'state',l.state) order by (l.state='pending') desc,l.created_at)
      from compi_private.schedule_leave l join team t on t.id=l.employee where me.access_rank=1 and (l.state='pending' or exists(select 1 from unnest(l.days) v where v>=month_start and v<until_day))),'[]')
  ) into result;
  return result;
end $$;


ALTER FUNCTION "compi_private"."schedule_view"("h" "text", "month_start" "date", "department" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."set_staff_access"("h" "text", "employee" "uuid", "enabled" boolean, "expected_rank" smallint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare member public.compi_staff%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(h,731));
  if not compi_private.active_download_session() or compi_private.my_rank(h) is distinct from 1 then
    raise insufficient_privilege;
  end if;
  if enabled is null then raise exception using errcode='22023',message='Indica el estado del acceso'; end if;
  select * into member from public.compi_staff where id=employee and hotel_key=h for update;
  if not found then raise exception using errcode='PT404',message='Empleado no disponible'; end if;
  if member.access_rank is distinct from expected_rank then
    raise exception using errcode='PT409',message='El rango ha cambiado. Actualiza la lista.';
  end if;
  if enabled = (member.withdrawn_at is null) then return; end if;
  if enabled then
    update public.compi_staff set withdrawn_at=null where id=member.id;
    if member.user_id is not null then
      insert into public.compi_memberships(user_id,hotel_key) values(member.user_id,h) on conflict do nothing;
    end if;
  else
    if member.user_id is null then
      raise exception using errcode='PT409',message='Este empleado aún no ha activado su cuenta.';
    end if;
    if member.access_rank=1 and not exists (
      select 1 from public.compi_staff s join public.compi_memberships m using(hotel_key,user_id)
       where s.hotel_key=h and s.access_rank=1 and s.withdrawn_at is null and s.id<>member.id
    ) then raise exception using errcode='PT409',message='Debe quedar un administrador activo en el hotel'; end if;
    delete from public.compi_memberships where user_id=member.user_id and hotel_key=h;
    update public.compi_staff set withdrawn_at=clock_timestamp() where id=member.id;
  end if;
end $$;


ALTER FUNCTION "compi_private"."set_staff_access"("h" "text", "employee" "uuid", "enabled" boolean, "expected_rank" smallint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."staff_change"("h" "text", "op" "text", "item" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "compi_private"."staff_change"("h" "text", "op" "text", "item" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."workspace_access"("h" "text", "o" "text", "g" "text", "writing" boolean DEFAULT false) RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare is_draft boolean;
begin
  if auth.uid() is null or not compi_private.active_download_session() then raise insufficient_privilege; end if;
  select r.guide_state='draft' into is_draft from public.compi_guides r where (r.hotel_key,r.outlet_key,r.guide_key)=(h,o,g);
  if not found then raise insufficient_privilege; end if;
  perform compi_private.file_access(h,o,g,'pdf',writing or is_draft);
  return is_draft;
end $$;


ALTER FUNCTION "compi_private"."workspace_access"("h" "text", "o" "text", "g" "text", "writing" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."workspace_data"("d" "jsonb") RETURNS "jsonb"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select coalesce((select pg_catalog.jsonb_object_agg(k, d->k)
      from unnest(array['nombre_es','nombre_en','sala_es','sala_en','codigo','version','fecha','partida','racion','pase','vajilla',
        'canal_zona','servicio_exterior','contiene','trazas','adaptaciones']) k
      where jsonb_typeof(d->k)='string'),'{}'::jsonb)
    || jsonb_build_object('ingredientes',coalesce((
      select jsonb_agg(jsonb_build_object('nombre',compi_private.workspace_text(i,'nombre',120),'cantidad',compi_private.workspace_text(i,'cantidad',40),'unidad',compi_private.workspace_text(i,'unidad',40)) order by n)
      from jsonb_array_elements(case when jsonb_typeof(d->'ingredientes')='array' then d->'ingredientes' else '[]'::jsonb end)
        with ordinality as rows(i,n) where n<=40 and jsonb_typeof(i->'nombre')='string'
    ),'[]'::jsonb),'pasos',coalesce((
      select jsonb_agg(jsonb_build_object('accion',compi_private.workspace_text(i,'accion',600),'control',compi_private.workspace_text(i,'control',300)) order by n)
      from jsonb_array_elements(case when jsonb_typeof(d->'pasos')='array' then d->'pasos' else '[]'::jsonb end)
        with ordinality as rows(i,n) where n<=24 and (jsonb_typeof(i->'accion')='string' or jsonb_typeof(i->'control')='string')
    ),'[]'::jsonb));
$$;


ALTER FUNCTION "compi_private"."workspace_data"("d" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "compi_private"."workspace_text"("d" "jsonb", "k" "text", "maximum" integer) RETURNS "text"
    LANGUAGE "sql" IMMUTABLE STRICT
    SET "search_path" TO ''
    AS $$
  select case when jsonb_typeof(d->k)='string' then left(d->>k,maximum) end
$$;


ALTER FUNCTION "compi_private"."workspace_text"("d" "jsonb", "k" "text", "maximum" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_activate_access"() RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
 if not compi_private.active_download_session() then raise exception using errcode='PT401',message='Vuelve a identificarte.'; end if;
end $$;


ALTER FUNCTION "public"."compi_activate_access"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_activate_executive"("employee" "uuid", "uid" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare s public.compi_staff%rowtype;
begin
  select * into s from public.compi_staff where id = employee for update;
  if not found or s.user_id is not null or s.withdrawn_at is not null or s.invite_state is distinct from 'prepared' or s.access_rank <> 1 then
    raise exception using errcode = 'PT409', message = 'El ejecutivo ya existe o no está disponible.';
  end if;
  if not exists (select 1 from auth.users u where u.id = uid and lower(u.email) = s.email and u.email_confirmed_at is not null) then
    raise exception using errcode = '22023', message = 'La cuenta no coincide con el ejecutivo.';
  end if;
  update public.compi_staff set user_id = uid, invite_state = 'accepted', invite_until = null where id = employee;
  insert into public.compi_memberships(user_id, hotel_key) values (uid, s.hotel_key) on conflict do nothing;
  update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('compi_must_change', 'true', 'compi_pwd_md5', md5(coalesce(encrypted_password, ''))) where id = uid;
  insert into compi_private.account_creations(hotel_key, created_by, employee) values (s.hotel_key, '00000000-0000-0000-0000-000000000000', employee);
end $$;


ALTER FUNCTION "public"."compi_activate_executive"("employee" "uuid", "uid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_acuarela_master"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select replace(encode(png,'base64'), E'\n','') from (
    select string_agg(data,''::bytea order by part) png from compi_private.acuarela_master_chunks
  ) art where encode(sha256(png),'hex')='b4a603e32ec54fd9e324ce082256ab3726bb158ced02103dfa81886a964e551f';
$$;


ALTER FUNCTION "public"."compi_acuarela_master"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_allow_auth_request"("endpoint" "text", "client" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare slot timestamptz:=date_trunc('minute',clock_timestamp()); count_used int;
begin
 if endpoint is null or endpoint not in ('accept','recover','relay') or client is null or client !~ '^[a-f0-9]{64}$' then return false;end if;
 delete from compi_private.auth_request_buckets b where b.minute<slot-interval '2 minutes';
 insert into compi_private.auth_request_buckets values(slot,endpoint,'all',1)
 on conflict on constraint auth_request_buckets_pkey do update set attempts=auth_request_buckets.attempts+1 returning attempts into count_used;
 if count_used>3000 then return false;end if;
 insert into compi_private.auth_request_buckets values(slot,endpoint,client,1)
 on conflict on constraint auth_request_buckets_pkey do update set attempts=auth_request_buckets.attempts+1 returning attempts into count_used;
 return count_used<=45;
end $_$;


ALTER FUNCTION "public"."compi_allow_auth_request"("endpoint" "text", "client" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_arts_catalog_change"("h" "text", "o" "text", "g" "text", "op" "text", "label" "text") RETURNS "text"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$ select compi_private.arts_catalog_change(h,o,g,op,label) $$;


ALTER FUNCTION "public"."compi_arts_catalog_change"("h" "text", "o" "text", "g" "text", "op" "text", "label" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_arts_classify_guide"("h" "text", "o" "text", "g" "text", "kind" "text", "category" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform pg_advisory_xact_lock(hashtextextended(h,731));
  perform compi_private.arts_workspace_access(h,o,g,true);
  if kind is not null and kind not in ('plato','elaboracion') or category is not null and category not in
    ('desayunos','entrantes','principales','postres','fondos','salsas','bases','guarniciones','otros') then raise invalid_parameter_value; end if;
  insert into compi_private.arts_guide_classifications values(h,o,g,kind,category)
    on conflict(hotel_key,outlet_key,guide_key) do update set kind=excluded.kind,category=excluded.category;
end $$;


ALTER FUNCTION "public"."compi_arts_classify_guide"("h" "text", "o" "text", "g" "text", "kind" "text", "category" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_arts_commit_file"("h" "text", "o" "text", "g" "text", "fmt" "text", "sha" "text", "previous" "text") RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$select compi_private.arts_commit_file(h,o,g,fmt,sha,previous)$$;


ALTER FUNCTION "public"."compi_arts_commit_file"("h" "text", "o" "text", "g" "text", "fmt" "text", "sha" "text", "previous" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_arts_cost_overview"("guides" "jsonb") RETURNS TABLE("hotel_key" "text", "outlet_key" "text", "guide_key" "text", "settings" "jsonb", "ingredient_count" integer)
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  with keys as materialized (
    select distinct k.h,k.o,k.g from pg_catalog.jsonb_to_recordset(guides) as k(h text,o text,g text)
    limit 200
  ), details as materialized (
    select k.*,public.compi_arts_recipe_cost(k.h,k.o,k.g) as entry from keys k
  )
  select h,o,g,entry->'settings',pg_catalog.jsonb_array_length(entry->'ingredientes') from details
$$;


ALTER FUNCTION "public"."compi_arts_cost_overview"("guides" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_arts_file_access"("h" "text", "o" "text", "g" "text", "fmt" "text", "editing" boolean) RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$select compi_private.arts_file_access(h,o,g,fmt,editing)$$;


ALTER FUNCTION "public"."compi_arts_file_access"("h" "text", "o" "text", "g" "text", "fmt" "text", "editing" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_arts_generator_outlet"("h" "text", "o" "text") RETURNS TABLE("hotel" "text", "outlet" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select x.hotel,x.outlet from public.compi_arts_outlets x
  join public.compi_my_access() a on a.hotel_key=x.hotel_key
  where x.hotel_key=h and x.outlet_key=o and not x.archived and a.access_rank in (1,2)
    and compi_private.active_download_session()
$$;


ALTER FUNCTION "public"."compi_arts_generator_outlet"("h" "text", "o" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_arts_guide_source"("h" "text", "o" "text", "g" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$select compi_private.arts_guide_source(h,o,g)$$;


ALTER FUNCTION "public"."compi_arts_guide_source"("h" "text", "o" "text", "g" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_arts_image_labels"("h" "text", "o" "text", "g" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform compi_private.arts_workspace_access(h,o,g,false);
  return (select jsonb_build_object('sha',a.sha,'labels',a.labels)
    from compi_private.arts_image_labels a where (a.hotel_key,a.outlet_key,a.guide_key)=(h,o,g));
end $$;


ALTER FUNCTION "public"."compi_arts_image_labels"("h" "text", "o" "text", "g" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_arts_recipe_cost"("h" "text", "o" "text", "g" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare item compi_private.arts_guide_costs%rowtype; ingredients jsonb;
begin
  if compi_private.my_rank(h) is distinct from 1 then raise insufficient_privilege; end if;
  perform compi_private.arts_workspace_access(h,o,g);
  select * into item from compi_private.arts_guide_costs c where (c.hotel_key,c.outlet_key,c.guide_key)=(h,o,g);
  select compi_private.workspace_data(s.data)->'ingredientes' into ingredients from compi_private.arts_workspace_sources s
    where (s.hotel_key,s.outlet_key,s.guide_key)=(h,o,g);
  return jsonb_build_object('revision',item.revision,'settings',item.settings,'ingredientes',coalesce(ingredients,'[]'::jsonb));
end $$;


ALTER FUNCTION "public"."compi_arts_recipe_cost"("h" "text", "o" "text", "g" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_arts_reserve_generated_draft"("h" "text", "o" "text", "ticket" "uuid", "label" "text", "fingerprint" "text") RETURNS "jsonb"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  select compi_private.arts_reserve_generated_draft(h,o,ticket,label,fingerprint)
$$;


ALTER FUNCTION "public"."compi_arts_reserve_generated_draft"("h" "text", "o" "text", "ticket" "uuid", "label" "text", "fingerprint" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_arts_review_guide"("h" "text", "o" "text", "g" "text", "reviewed" boolean) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform pg_advisory_xact_lock(hashtextextended(h,731));
  perform compi_private.arts_workspace_access(h,o,g);
  if reviewed is null then raise invalid_parameter_value; end if;
  if reviewed then insert into compi_private.arts_guide_reviews values(auth.uid(),h,o,g) on conflict do nothing;
  else delete from compi_private.arts_guide_reviews v where (v.user_id,v.hotel_key,v.outlet_key,v.guide_key)=(auth.uid(),h,o,g); end if;
  return reviewed;
end $$;


ALTER FUNCTION "public"."compi_arts_review_guide"("h" "text", "o" "text", "g" "text", "reviewed" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_arts_save_guide_source"("h" "text", "o" "text", "g" "text", "source" "jsonb", "docx" "text", "pdf" "text", "previous" "uuid") RETURNS "uuid"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$select compi_private.arts_save_guide_source(h,o,g,source,docx,pdf,previous)$$;


ALTER FUNCTION "public"."compi_arts_save_guide_source"("h" "text", "o" "text", "g" "text", "source" "jsonb", "docx" "text", "pdf" "text", "previous" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_arts_save_recipe_cost"("h" "text", "o" "text", "g" "text", "settings" "jsonb", "previous" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
end $$;


ALTER FUNCTION "public"."compi_arts_save_recipe_cost"("h" "text", "o" "text", "g" "text", "settings" "jsonb", "previous" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_arts_stage_guide_access"("h" "text", "o" "text", "g" "text", "fmt" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
begin
 if auth.uid() is null or not exists(select 1 from public.compi_arts_generator_outlet(h,o))
    or not exists(select 1 from public.compi_arts_guides r where (r.hotel_key,r.outlet_key,r.guide_key)=(h,o,g) and r.guide_state='draft')
 then raise insufficient_privilege; end if;
 return compi_private.arts_file_access(h,o,g,fmt,true);
end $$;


ALTER FUNCTION "public"."compi_arts_stage_guide_access"("h" "text", "o" "text", "g" "text", "fmt" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_arts_workspace_catalog"("after_h" "text" DEFAULT ''::"text", "after_o" "text" DEFAULT ''::"text", "after_g" "text" DEFAULT ''::"text", "batch" integer DEFAULT 200) RETURNS TABLE("hotel_key" "text", "outlet_key" "text", "guide_key" "text", "hotel" "text", "outlet" "text", "title" "text", "guide_state" "text", "kind" "text", "category" "text", "reviewed" boolean, "can_classify" boolean, "has_source" boolean, "has_image" boolean, "image_kind" "text", "has_clean" boolean, "partida" "text", "racion" "text", "pase" "text", "sala_es" "text", "nombre_en" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."compi_arts_workspace_catalog"("after_h" "text", "after_o" "text", "after_g" "text", "batch" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_arts_workspace_guide"("h" "text", "o" "text", "g" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform compi_private.arts_workspace_access(h,o,g);
  return (select jsonb_build_object('data',compi_private.workspace_data(s.data),'has_image',s.approved_sha is not null,
    'image_kind',s.image_kind,'has_clean',s.clean_sha is not null)
    from compi_private.arts_workspace_sources s where (s.hotel_key,s.outlet_key,s.guide_key)=(h,o,g));
end $$;


ALTER FUNCTION "public"."compi_arts_workspace_guide"("h" "text", "o" "text", "g" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_arts_workspace_media"("h" "text", "o" "text", "g" "text", "variant" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare is_draft boolean; item compi_private.arts_workspace_sources%rowtype; slot text; digest text;
begin
  is_draft:=compi_private.arts_workspace_access(h,o,g);
  if variant is null or variant not in ('approved','clean') then raise invalid_parameter_value; end if;
  select * into item from compi_private.arts_workspace_sources s where (s.hotel_key,s.outlet_key,s.guide_key)=(h,o,g);
  if variant='clean' then slot:='art'; digest:=item.clean_sha;
  else slot:=case item.image_kind when 'foto' then 'photo' when 'acuarela' then 'image' end; digest:=item.approved_sha; end if;
  if slot is null or digest is null or digest !~ '^[0-9a-f]{64}$' then return null; end if;
  return jsonb_build_object('slot',slot,'sha256',digest,'revision',item.revision,'draft',is_draft);
end $_$;


ALTER FUNCTION "public"."compi_arts_workspace_media"("h" "text", "o" "text", "g" "text", "variant" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_assistant_settings"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select coalesce(pg_catalog.jsonb_object_agg(s.env_name, v.decrypted_secret), '{}'::jsonb)
  from (values
    ('compi_assistant_openai_api_key', 'OPENAI_API_KEY'),
    ('compi_assistant_compositor_url', 'COMPI_COMPOSITOR_URL'),
    ('compi_assistant_compositor_token', 'COMPI_COMPOSITOR_TOKEN')
  ) as s(vault_name, env_name)
  join vault.decrypted_secrets as v on v.name = s.vault_name;
$$;


ALTER FUNCTION "public"."compi_assistant_settings"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_begin_accept"("ticket" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare sid uuid; s public.compi_staff%rowtype; t compi_private.lab_tickets%rowtype; a uuid:=gen_random_uuid(); u auth.users%rowtype;
begin
 if ticket !~ '^v7_[0-9a-f]{64}$' then raise insufficient_privilege; end if;
 select employee into sid from compi_private.lab_tickets where digest=sha256(convert_to(ticket,'UTF8'));
 select * into s from public.compi_staff where id=sid for update;
 select * into t from compi_private.lab_tickets where employee=sid for update;
 if t.digest is distinct from sha256(convert_to(ticket,'UTF8')) or s.id is null or s.invite_state not in ('queued','issued','delivered')
 or s.invite_until<=clock_timestamp() or s.user_id is not null or s.withdrawn_at is not null then raise insufficient_privilege; end if;
 if t.lease_until>now() then raise exception using errcode='PT409',message='Activación en curso'; end if;
 select * into u from auth.users where lower(email)=s.email;
 if u.id is not null and (u.email_confirmed_at is not null or (u.invited_at is null and u.raw_app_meta_data->>'compi_lab_staff' is distinct from sid::text) or exists(select 1 from public.compi_memberships where user_id=u.id)) then
  raise insufficient_privilege;
 end if;
 update compi_private.lab_tickets set attempt=a,lease_until=now()+interval '1 minute' where employee=sid;
 return jsonb_build_object('attempt',a,'email',s.email,'legacy_id',u.id,'employee',sid);
end $_$;


ALTER FUNCTION "public"."compi_begin_accept"("ticket" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_begin_recovery"("address" "text", "code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare backup compi_private.backup_codes%rowtype; uid uuid; lease uuid:=gen_random_uuid();
begin
  if code is null or code !~ '^[A-F0-9]{40}$' then raise insufficient_privilege; end if;
  select id into uid from auth.users where lower(email)=address and email_confirmed_at is not null;
  select b.* into backup from compi_private.backup_codes b where b.owner=uid and b.digest=sha256(convert_to(code,'UTF8')) for update;
  if not found or not compi_private.has_lab_account(uid) or backup.lease_until>clock_timestamp() then raise insufficient_privilege; end if;
  update compi_private.backup_codes set attempt=lease,lease_until=clock_timestamp()+interval '60 seconds',
    original_fingerprint=(select sha256(convert_to(u.encrypted_password,'UTF8')) from auth.users u where u.id=uid) where owner=uid;
  return jsonb_build_object('uid',uid,'attempt',lease);
end $_$;


ALTER FUNCTION "public"."compi_begin_recovery"("address" "text", "code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_catalog_change"("h" "text", "o" "text", "g" "text", "op" "text", "label" "text") RETURNS "text"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$ select compi_private.catalog_change(h,o,g,op,label) $$;


ALTER FUNCTION "public"."compi_catalog_change"("h" "text", "o" "text", "g" "text", "op" "text", "label" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_classify_guide"("h" "text", "o" "text", "g" "text", "kind" "text", "category" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform pg_advisory_xact_lock(hashtextextended(h,731));
  perform compi_private.workspace_access(h,o,g,true);
  if kind is not null and kind not in ('plato','elaboracion') or category is not null and category not in
    ('entrantes','principales','postres','fondos','salsas','bases','guarniciones','otros') then raise invalid_parameter_value; end if;
  insert into compi_private.guide_classifications values(h,o,g,kind,category)
    on conflict(hotel_key,outlet_key,guide_key) do update set kind=excluded.kind,category=excluded.category;
end $$;


ALTER FUNCTION "public"."compi_classify_guide"("h" "text", "o" "text", "g" "text", "kind" "text", "category" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_commit_document_brand"("h" "text", "accent" "text", "logo_png" "text", "expected_revision" integer, "verified_sub" "uuid", "verified_session" "uuid", "verified_aal" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare prior text:=current_setting('request.jwt.claims',true); current_brand jsonb; result jsonb;
begin
  if verified_sub is null or verified_session is null or verified_aal is null or verified_aal not in ('aal1','aal2') then
    raise insufficient_privilege;
  end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',verified_sub,'session_id',verified_session,'aal',verified_aal,'role','authenticated')::text,true);
  perform pg_advisory_xact_lock(hashtextextended(h,731));
  if compi_private.my_rank(h) is distinct from 1 then raise insufficient_privilege;end if;
  if accent is null or accent !~ '^[A-F0-9]{6}$' or expected_revision is null or expected_revision<0 or
      (logo_png is not null and (length(logo_png)>349528 or logo_png not like 'iVBORw0KGgo%')) then
    raise invalid_parameter_value;
  end if;
  current_brand:=compi_private.document_brand(h);
  if (current_brand->>'revision')::integer<>expected_revision then
    if (current_brand->>'accent')=accent and (current_brand->>'logo_png') is not distinct from logo_png then
      perform set_config('request.jwt.claims',coalesce(prior,''),true); return current_brand;
    end if;
    raise exception using errcode='PT409',message='La identidad del hotel ha cambiado.';
  end if;
  if (current_brand->>'accent')=accent and (current_brand->>'logo_png') is not distinct from logo_png then
    result:=current_brand;
  else
    insert into compi_private.document_brands as b (hotel_key,accent,logo_png,revision)
      values(h,accent,logo_png,expected_revision+1)
      on conflict(hotel_key) do update set accent=excluded.accent,logo_png=excluded.logo_png,revision=excluded.revision,updated_at=now();
    result:=compi_private.document_brand(h);
  end if;
  perform set_config('request.jwt.claims',coalesce(prior,''),true);
  return result;
end $_$;


ALTER FUNCTION "public"."compi_commit_document_brand"("h" "text", "accent" "text", "logo_png" "text", "expected_revision" integer, "verified_sub" "uuid", "verified_session" "uuid", "verified_aal" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_commit_file"("h" "text", "o" "text", "g" "text", "fmt" "text", "sha" "text", "previous" "text") RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$select compi_private.commit_file(h,o,g,fmt,sha,previous)$$;


ALTER FUNCTION "public"."compi_commit_file"("h" "text", "o" "text", "g" "text", "fmt" "text", "sha" "text", "previous" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_delete_withdrawn_employee"("h" "text", "employee" "uuid", "withdrawal" timestamp with time zone) RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$ select compi_private.delete_withdrawn_employee(h,employee,withdrawal) $$;


ALTER FUNCTION "public"."compi_delete_withdrawn_employee"("h" "text", "employee" "uuid", "withdrawal" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_document_brand"("h" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$ select compi_private.document_brand(h) $$;


ALTER FUNCTION "public"."compi_document_brand"("h" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_document_brand_revision"("h" "text") RETURNS integer
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$ select compi_private.document_brand_revision(h) $$;


ALTER FUNCTION "public"."compi_document_brand_revision"("h" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_file_access"("h" "text", "o" "text", "g" "text", "fmt" "text", "editing" boolean) RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$select compi_private.file_access(h,o,g,fmt,editing)$$;


ALTER FUNCTION "public"."compi_file_access"("h" "text", "o" "text", "g" "text", "fmt" "text", "editing" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_finish_password_change"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare u auth.users%rowtype;
begin
  select * into u from auth.users where id = auth.uid() for update;
  if not found then raise insufficient_privilege; end if;
  if coalesce(u.raw_app_meta_data->>'compi_must_change', '') <> 'true' then return true; end if;
  if md5(coalesce(u.encrypted_password, '')) = coalesce(u.raw_app_meta_data->>'compi_pwd_md5', '') then
    raise exception using errcode = '22023', message = 'La contraseña todavía no ha cambiado.';
  end if;
  update auth.users set raw_app_meta_data = raw_app_meta_data - 'compi_must_change' - 'compi_pwd_md5' where id = u.id;
  return true;
end $$;


ALTER FUNCTION "public"."compi_finish_password_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_generator_outlet"("h" "text", "o" "text") RETURNS TABLE("hotel" "text", "outlet" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select x.hotel,x.outlet from public.compi_outlets x
  join public.compi_my_access() a on a.hotel_key=x.hotel_key
  where x.hotel_key=h and x.outlet_key=o and not x.archived and a.access_rank in (1,2)
    and compi_private.active_download_session()
$$;


ALTER FUNCTION "public"."compi_generator_outlet"("h" "text", "o" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_guide_source"("h" "text", "o" "text", "g" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$select compi_private.guide_source(h,o,g)$$;


ALTER FUNCTION "public"."compi_guide_source"("h" "text", "o" "text", "g" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_lab_invitee"("h" "text", "employee" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$ select compi_private.lab_invitee(h,employee) $$;


ALTER FUNCTION "public"."compi_lab_invitee"("h" "text", "employee" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_lab_mail_finish"("p_employee" "uuid", "p_attempt" "uuid", "p_message" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if p_message is not null and length(p_message) not between 100 and 12000 then return false; end if;
  update compi_private.lab_mail_outbox
  set message=p_message, queued_at=case when p_message is not null then clock_timestamp() end,
      attempt=null, lease_until=null
  where employee=p_employee and attempt=p_attempt and queued_at is null and expires_at>clock_timestamp();
  return found;
end $$;


ALTER FUNCTION "public"."compi_lab_mail_finish"("p_employee" "uuid", "p_attempt" "uuid", "p_message" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_lab_mail_reserve"("p_employee" "uuid", "p_recipient" "text", "p_attempt" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare slot compi_private.lab_mail_outbox%rowtype;
begin
  select * into slot from compi_private.lab_mail_outbox
   where employee=p_employee and recipient=p_recipient and expires_at>clock_timestamp() for update;
  if not found then return 'unavailable'; end if;
  if slot.queued_at is not null then return 'queued'; end if;
  if slot.lease_until>clock_timestamp() then return 'busy'; end if;
  update compi_private.lab_mail_outbox set attempt=p_attempt, lease_until=clock_timestamp()+interval '2 minutes'
    where employee=p_employee;
  return 'reserved';
end $$;


ALTER FUNCTION "public"."compi_lab_mail_reserve"("p_employee" "uuid", "p_recipient" "text", "p_attempt" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_lab_relay"("addr" "text", "proof" "text", "receipt" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare sid uuid; s public.compi_staff%rowtype; b compi_private.lab_mail_outbox%rowtype; a uuid:=gen_random_uuid();
begin
 if proof is null or proof !~ '^[a-f0-9]{64}$' or addr !~ '^[a-z0-9._+-]+@compichef[.]com$' then raise insufficient_privilege; end if;
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
end $_$;


ALTER FUNCTION "public"."compi_lab_relay"("addr" "text", "proof" "text", "receipt" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_link_created_account"("employee" "uuid", "uid" "uuid", "creator" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare s public.compi_staff%rowtype;
begin
  select * into s from public.compi_staff where id = employee for update;
  if not found or s.user_id is not null or s.withdrawn_at is not null or s.invite_state is distinct from 'prepared' then
    raise exception using errcode = 'PT409', message = 'La cuenta ya existe o el empleado no está disponible.';
  end if;
  if not exists (select 1 from public.compi_staff c join public.compi_memberships m using (user_id, hotel_key)
                  where c.user_id = creator and c.hotel_key = s.hotel_key and c.access_rank = 1 and c.withdrawn_at is null) then
    raise insufficient_privilege;
  end if;
  if not exists (select 1 from auth.users u where u.id = uid and lower(u.email) = s.email and u.email_confirmed_at is not null) then
    raise exception using errcode = '22023', message = 'La cuenta no coincide con el empleado.';
  end if;
  if (select count(*) from compi_private.account_creations a where a.created_by = creator and a.created_at > now() - interval '10 minutes') >= 30 then
    raise exception using errcode = 'PT429', message = 'Demasiadas cuentas creadas. Inténtalo más tarde.';
  end if;
  update public.compi_staff set user_id = uid, invite_state = 'accepted', invite_until = null where id = employee;
  update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('compi_must_change', 'true', 'compi_pwd_md5', md5(coalesce(encrypted_password, ''))) where id = uid;
  insert into public.compi_memberships(user_id, hotel_key) values (uid, s.hotel_key) on conflict do nothing;
  insert into compi_private.account_creations(hotel_key, created_by, employee) values (s.hotel_key, creator, employee);
end $$;


ALTER FUNCTION "public"."compi_link_created_account"("employee" "uuid", "uid" "uuid", "creator" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_mail_change"("h" "text", "op" "text", "data" "jsonb") RETURNS "jsonb"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$ select compi_private.mail_change(h,op,data) $$;


ALTER FUNCTION "public"."compi_mail_change"("h" "text", "op" "text", "data" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_mail_read"("h" "text", "box" "text" DEFAULT 'inbox'::"text", "p" integer DEFAULT 0, "item" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$ select compi_private.mail_read(h,box,p,item) $$;


ALTER FUNCTION "public"."compi_mail_read"("h" "text", "box" "text", "p" integer, "item" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_manage_invitation"("h" "text", "employee" "uuid", "op" "text", "previous" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare s public.compi_staff%rowtype; box compi_private.lab_mail_outbox%rowtype;
 ticket text; rev uuid:=gen_random_uuid(); deadline timestamptz; mime text; body text;
begin
 if not compi_private.active_download_session() or compi_private.my_rank(h) is distinct from 1 then raise insufficient_privilege; end if;
 select * into s from public.compi_staff where id=employee and hotel_key=h for update;
 if not found or s.email !~ '^[a-z0-9._+-]+@compichef[.]com$' then raise insufficient_privilege; end if;
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
   'https://compichef.com/invitacion.html#'||ticket||E'\r\n\r\n'||'El enlace es de un solo uso.';
  mime:=concat_ws(E'\r\n','From: CompI Laboratorio <invitaciones@compichef.com>','To: '||s.email,
   'Subject: =?UTF-8?B?VHUgaW52aXRhY2nDs24gYSBDb21wSSBMYWJvcmF0b3Jpbw==?=',
   'Message-ID: <'||rev||'@compichef.com>','Date: '||to_char(now() at time zone 'UTC','Dy, DD Mon YYYY HH24:MI:SS')||' +0000',
   'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',
   replace(encode(convert_to(body,'UTF8'),'base64'),E'\n',E'\r\n'),'');
  update compi_private.lab_mail_outbox b set message=mime,queued_at=now(),attempt=null,lease_until=null where b.employee=s.id;

 update public.compi_staff set invite_state='queued',invite_until=deadline,invite_revision=rev where id=s.id;
 return jsonb_build_object('queued',true,'state','queued');
end $_$;


ALTER FUNCTION "public"."compi_manage_invitation"("h" "text", "employee" "uuid", "op" "text", "previous" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_my_access"() RETURNS TABLE("hotel_key" "text", "access_rank" smallint)
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
begin
  if not compi_private.active_download_session() then raise exception using errcode='PT401',message='Vuelve a iniciar sesión.'; end if;
  return query select s.hotel_key,s.access_rank from public.compi_staff s join public.compi_memberships m using(user_id,hotel_key)
    where s.user_id=(select auth.uid()) and s.withdrawn_at is null order by s.hotel_key;
end $$;


ALTER FUNCTION "public"."compi_my_access"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_needs_mfa"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select coalesce(auth.jwt()->>'aal', '') <> 'aal2' and exists (
    select 1
    from public.compi_staff s
    join public.compi_memberships m using (user_id, hotel_key)
    where s.user_id = auth.uid()
      and s.access_rank = 1
      and s.withdrawn_at is null
      and not exists (
        select 1 from compi_private.executive_password_only e
        where e.employee_id = s.id and e.user_id = s.user_id and e.hotel_key = s.hotel_key
          and s.hotel_key = 'hotel-arts-barcelona' and s.email = 'l.ribeiro.ejecutivo@compichef.com'
      )
  )
$$;


ALTER FUNCTION "public"."compi_needs_mfa"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_personal_backup"("issue" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  select compi_private.personal_backup(issue)
$$;


ALTER FUNCTION "public"."compi_personal_backup"("issue" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_provision_lab_channel"("h" "text", "employee_id" "uuid", "recipient_address" "text", "proof_hash" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare member public.compi_staff;
begin
 select * into member from public.compi_staff where id=employee_id and hotel_key=h for update;
 if not found or member.user_id is not null or member.withdrawn_at is not null or member.email<>recipient_address
    or proof_hash is null or proof_hash !~ '^[a-f0-9]{64}$' then raise insufficient_privilege;end if;
 delete from compi_private.lab_tickets where employee=member.id;
 insert into compi_private.lab_mail_outbox(employee,recipient,expires_at,relay_key_hash)
 values(member.id,member.email,now()+interval '7 days',proof_hash)
 on conflict(employee) do update set expires_at=excluded.expires_at,relay_key_hash=excluded.relay_key_hash,
 message=null,attempt=null,lease_until=null,queued_at=null;
 update public.compi_staff set invite_state='prepared',invite_until=null,invite_revision=gen_random_uuid() where id=member.id;
end $_$;


ALTER FUNCTION "public"."compi_provision_lab_channel"("h" "text", "employee_id" "uuid", "recipient_address" "text", "proof_hash" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_recipe_cost"("h" "text", "o" "text", "g" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare item compi_private.guide_costs%rowtype; ingredients jsonb;
begin
  if compi_private.my_rank(h) is distinct from 1 then raise insufficient_privilege; end if;
  perform compi_private.workspace_access(h,o,g);
  select * into item from compi_private.guide_costs c where (c.hotel_key,c.outlet_key,c.guide_key)=(h,o,g);
  select compi_private.workspace_data(s.data)->'ingredientes' into ingredients from compi_private.workspace_sources s
    where (s.hotel_key,s.outlet_key,s.guide_key)=(h,o,g);
  return jsonb_build_object('revision',item.revision,'settings',item.settings,'ingredientes',coalesce(ingredients,'[]'::jsonb));
end $$;


ALTER FUNCTION "public"."compi_recipe_cost"("h" "text", "o" "text", "g" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_register_employee"("h" "text", "request_id" "uuid", "given_name" "text", "surname" "text", "position_name" "text", "outlet_name" "text", "access_rank" smallint) RETURNS "text"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  select compi_private.register_address(h,request_id,given_name,surname,position_name,outlet_name,access_rank)
$$;


ALTER FUNCTION "public"."compi_register_employee"("h" "text", "request_id" "uuid", "given_name" "text", "surname" "text", "position_name" "text", "outlet_name" "text", "access_rank" smallint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_release_recovery"("uid" "uuid", "lease" "uuid") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  update compi_private.backup_codes set attempt=null,lease_until=null,original_fingerprint=null where owner=uid and attempt=lease
$$;


ALTER FUNCTION "public"."compi_release_recovery"("uid" "uuid", "lease" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_remove_pending_employee"("h" "text", "employee" "uuid") RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$ select compi_private.remove_pending_employee(h, employee) $$;


ALTER FUNCTION "public"."compi_remove_pending_employee"("h" "text", "employee" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_reserve_executive"("h" "text", "given_name" "text", "surname" "text", "position_name" "text", "outlet_name" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  given text := regexp_replace(lower(pg_catalog.normalize(btrim(given_name),'NFKD')),'[^a-z]','','g');
  family text := regexp_replace(lower(pg_catalog.normalize(btrim(surname),'NFKD')),'[^a-z]','','g');
  full_name text := concat_ws(' ',btrim(given_name),btrim(surname));
  letters text; stem text; suffix text; candidate text; step int:=1; hcode text; sid uuid:=gen_random_uuid();
begin
  select c.code into hcode from compi_private.hotel_codes c where c.hotel_key=h;
  if hcode is null then raise exception using errcode='22023',message='Este hotel no tiene código de correo.'; end if;
  if coalesce(given,'')='' or coalesce(family,'')='' or length(full_name)>120 or
     coalesce(length(btrim(position_name)),0) not between 1 and 120 or coalesce(length(btrim(outlet_name)),0) not between 1 and 120 then
    raise exception using errcode='22023',message='Revisa el nombre, el apellido, el puesto y el outlet.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('compi.corporate.addresses',14));
  letters:=left(given,1)||regexp_replace(substr(given,2),'[aeiou]','','g')||regexp_replace(substr(given,2),'[^aeiou]','','g');
  family:=left(family,36); letters:=left(letters,12);
  loop
    stem:=left(letters,step);
    suffix:=case when step>length(letters) then (step-length(letters)+1)::text else '' end;
    candidate:=stem||suffix||'.'||family||'.'||hcode||'@compichef.com';
    exit when not exists(select 1 from compi_private.address_allocations a where a.address=candidate)
      and not exists(select 1 from public.compi_staff s where s.email=candidate)
      and not exists(select 1 from auth.users u where lower(u.email)=candidate);
    step:=step+1;
  end loop;
  insert into compi_private.address_allocations values(sid,candidate,h,'00000000-0000-0000-0000-000000000000',jsonb_build_array(full_name,position_name,outlet_name,1));
  insert into public.compi_staff(id,hotel_key,employee_name,email,position_name,outlet_name,access_rank,invite_state)
    values(sid,h,full_name,candidate,btrim(position_name),btrim(outlet_name),1,'prepared');
  return jsonb_build_object('employee',sid,'email',candidate);
end $$;


ALTER FUNCTION "public"."compi_reserve_executive"("h" "text", "given_name" "text", "surname" "text", "position_name" "text", "outlet_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_reserve_generated_draft"("h" "text", "o" "text", "ticket" "uuid", "label" "text", "fingerprint" "text") RETURNS "jsonb"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  select compi_private.reserve_generated_draft(h,o,ticket,label,fingerprint)
$$;


ALTER FUNCTION "public"."compi_reserve_generated_draft"("h" "text", "o" "text", "ticket" "uuid", "label" "text", "fingerprint" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_review_guide"("h" "text", "o" "text", "g" "text", "reviewed" boolean) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform pg_advisory_xact_lock(hashtextextended(h,731));
  perform compi_private.workspace_access(h,o,g);
  if reviewed is null then raise invalid_parameter_value; end if;
  if reviewed then insert into compi_private.guide_reviews values(auth.uid(),h,o,g) on conflict do nothing;
  else delete from compi_private.guide_reviews v where (v.user_id,v.hotel_key,v.outlet_key,v.guide_key)=(auth.uid(),h,o,g); end if;
  return reviewed;
end $$;


ALTER FUNCTION "public"."compi_review_guide"("h" "text", "o" "text", "g" "text", "reviewed" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_save_guide_source"("h" "text", "o" "text", "g" "text", "source" "jsonb", "docx" "text", "pdf" "text", "previous" "uuid") RETURNS "uuid"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$select compi_private.save_guide_source(h,o,g,source,docx,pdf,previous)$$;


ALTER FUNCTION "public"."compi_save_guide_source"("h" "text", "o" "text", "g" "text", "source" "jsonb", "docx" "text", "pdf" "text", "previous" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_save_recipe_cost"("h" "text", "o" "text", "g" "text", "settings" "jsonb", "previous" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare old compi_private.guide_costs%rowtype; item jsonb; next_id uuid:=gen_random_uuid();
begin
  perform pg_advisory_xact_lock(hashtextextended(h,731));
  if compi_private.my_rank(h) is distinct from 1 then raise insufficient_privilege; end if;
  perform compi_private.workspace_access(h,o,g,true);
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
  select * into old from compi_private.guide_costs c where (c.hotel_key,c.outlet_key,c.guide_key)=(h,o,g);
  if old.settings=settings then return old.revision; end if;
  if old.revision is distinct from previous then raise exception using errcode='PT409',message='Los costes han cambiado. Vuelve a abrir el escandallo.'; end if;
  insert into compi_private.guide_costs values(h,o,g,next_id,settings)
    on conflict (hotel_key,outlet_key,guide_key) do update set revision=excluded.revision,settings=excluded.settings;
  return next_id;
end $$;


ALTER FUNCTION "public"."compi_save_recipe_cost"("h" "text", "o" "text", "g" "text", "settings" "jsonb", "previous" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_schedule_balance"("h" "text", "employee_id" "uuid", "month_start" "date", "adjustment" integer, "previous" "uuid") RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
 select compi_private.schedule_balance(h,employee_id,month_start,adjustment,previous)
$$;


ALTER FUNCTION "public"."compi_schedule_balance"("h" "text", "employee_id" "uuid", "month_start" "date", "adjustment" integer, "previous" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_schedule_decide"("h" "text", "request_id" "uuid", "decision" "text") RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
 select compi_private.schedule_decide(h,request_id,decision)
$$;


ALTER FUNCTION "public"."compi_schedule_decide"("h" "text", "request_id" "uuid", "decision" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_schedule_edit"("h" "text", "employee_id" "uuid", "work_day" "date", "kind" "text", "start_time" time without time zone, "end_time" time without time zone, "previous" "uuid") RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
 select compi_private.schedule_edit(h,employee_id,work_day,kind,start_time,end_time,previous)
$$;


ALTER FUNCTION "public"."compi_schedule_edit"("h" "text", "employee_id" "uuid", "work_day" "date", "kind" "text", "start_time" time without time zone, "end_time" time without time zone, "previous" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_schedule_request"("h" "text", "request_id" "uuid", "requested" "date"[]) RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
 select compi_private.schedule_request(h,request_id,requested)
$$;


ALTER FUNCTION "public"."compi_schedule_request"("h" "text", "request_id" "uuid", "requested" "date"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_schedule_view"("h" "text", "month_start" "date", "department" "text") RETURNS "jsonb"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
 select compi_private.schedule_view(h,month_start,department)
$$;


ALTER FUNCTION "public"."compi_schedule_view"("h" "text", "month_start" "date", "department" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_set_staff_access"("h" "text", "employee" "uuid", "enabled" boolean, "expected_rank" smallint) RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  select compi_private.set_staff_access(h,employee,enabled,expected_rank)
$$;


ALTER FUNCTION "public"."compi_set_staff_access"("h" "text", "employee" "uuid", "enabled" boolean, "expected_rank" smallint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_staff_change"("h" "text", "op" "text", "item" "jsonb") RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$ select compi_private.staff_change(h,op,item) $$;


ALTER FUNCTION "public"."compi_staff_change"("h" "text", "op" "text", "item" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_stage_guide_access"("h" "text", "o" "text", "g" "text", "fmt" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
begin
 if auth.uid() is null or not exists(select 1 from public.compi_generator_outlet(h,o))
    or not exists(select 1 from public.compi_guides r where (r.hotel_key,r.outlet_key,r.guide_key)=(h,o,g) and r.guide_state='draft')
 then raise insufficient_privilege; end if;
 return compi_private.file_access(h,o,g,fmt,true);
end $$;


ALTER FUNCTION "public"."compi_stage_guide_access"("h" "text", "o" "text", "g" "text", "fmt" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_workspace_catalog"("after_h" "text" DEFAULT ''::"text", "after_o" "text" DEFAULT ''::"text", "after_g" "text" DEFAULT ''::"text", "batch" integer DEFAULT 200) RETURNS TABLE("hotel_key" "text", "outlet_key" "text", "guide_key" "text", "hotel" "text", "outlet" "text", "title" "text", "guide_state" "text", "kind" "text", "category" "text", "reviewed" boolean, "can_classify" boolean, "has_source" boolean, "has_image" boolean, "image_kind" "text", "has_clean" boolean, "partida" "text", "racion" "text", "pase" "text", "sala_es" "text", "nombre_en" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select r.hotel_key,r.outlet_key,r.guide_key,r.hotel,r.outlet,r.title,r.guide_state,c.kind,c.category,
    v.user_id is not null, a.access_rank in (1,2), s.revision is not null, s.approved_sha is not null,s.image_kind,s.clean_sha is not null,
    compi_private.workspace_text(s.data,'partida',80),compi_private.workspace_text(s.data,'racion',60),
    compi_private.workspace_text(s.data,'pase',60),compi_private.workspace_text(s.data,'sala_es',600),compi_private.workspace_text(s.data,'nombre_en',120)
  from public.compi_my_access() a
  join public.compi_guides r on r.hotel_key=a.hotel_key
  join public.compi_outlets f on (f.hotel_key,f.outlet_key)=(r.hotel_key,r.outlet_key) and not f.archived
  left join compi_private.guide_classifications c on (c.hotel_key,c.outlet_key,c.guide_key)=(r.hotel_key,r.outlet_key,r.guide_key)
  left join compi_private.guide_reviews v on (v.hotel_key,v.outlet_key,v.guide_key,v.user_id)=(r.hotel_key,r.outlet_key,r.guide_key,auth.uid())
  left join compi_private.workspace_sources s on (s.hotel_key,s.outlet_key,s.guide_key)=(r.hotel_key,r.outlet_key,r.guide_key)
     and (r.guide_state='ready' or a.access_rank in (1,2))
  where a.access_rank in (1,2,3) and
    (r.guide_state='ready' or (r.guide_state='draft' and (a.access_rank=1 or r.created_by=auth.uid())))
    and (r.hotel_key,r.outlet_key,r.guide_key)>(after_h,after_o,after_g)
  order by r.hotel_key,r.outlet_key,r.guide_key limit greatest(1,least(200,batch))
$$;


ALTER FUNCTION "public"."compi_workspace_catalog"("after_h" "text", "after_o" "text", "after_g" "text", "batch" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_workspace_guide"("h" "text", "o" "text", "g" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform compi_private.workspace_access(h,o,g);
  return (select jsonb_build_object('data',compi_private.workspace_data(s.data),'has_image',s.approved_sha is not null,
    'image_kind',s.image_kind,'has_clean',s.clean_sha is not null)
    from compi_private.workspace_sources s where (s.hotel_key,s.outlet_key,s.guide_key)=(h,o,g));
end $$;


ALTER FUNCTION "public"."compi_workspace_guide"("h" "text", "o" "text", "g" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compi_workspace_media"("h" "text", "o" "text", "g" "text", "variant" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare is_draft boolean; item compi_private.workspace_sources%rowtype; slot text; digest text;
begin
  is_draft:=compi_private.workspace_access(h,o,g);
  if variant is null or variant not in ('approved','clean') then raise invalid_parameter_value; end if;
  select * into item from compi_private.workspace_sources s where (s.hotel_key,s.outlet_key,s.guide_key)=(h,o,g);
  if variant='clean' then slot:='art'; digest:=item.clean_sha;
  else slot:=case item.image_kind when 'foto' then 'photo' when 'acuarela' then 'image' end; digest:=item.approved_sha; end if;
  if slot is null or digest is null or digest !~ '^[0-9a-f]{64}$' then return null; end if;
  return jsonb_build_object('slot',slot,'sha256',digest,'revision',item.revision,'draft',is_draft);
end $_$;


ALTER FUNCTION "public"."compi_workspace_media"("h" "text", "o" "text", "g" "text", "variant" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."access_events" (
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "hotel" "text",
    "actor" "uuid",
    "employee" "uuid",
    "event" "text" NOT NULL
);


ALTER TABLE "compi_private"."access_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."account_creations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "hotel_key" "text" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "employee" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "compi_private"."account_creations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."acuarela_master_chunks" (
    "part" smallint NOT NULL,
    "data" "bytea" NOT NULL,
    CONSTRAINT "acuarela_master_chunks_part_check" CHECK (("part" >= 0))
);


ALTER TABLE "compi_private"."acuarela_master_chunks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."address_allocations" (
    "request_id" "uuid" NOT NULL,
    "address" "text" NOT NULL,
    "hotel" "text",
    "registrar" "uuid",
    "submitted" "jsonb"
);


ALTER TABLE "compi_private"."address_allocations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."arts_drive_originals" (
    "hotel_key" "text" NOT NULL,
    "outlet_key" "text" NOT NULL,
    "guide_key" "text" NOT NULL,
    "format" "text" NOT NULL,
    "digest" "text" NOT NULL,
    "drive_id" "text" NOT NULL,
    CONSTRAINT "arts_drive_originals_digest_check" CHECK (("digest" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "arts_drive_originals_format_check" CHECK (("format" = ANY (ARRAY['pdf'::"text", 'docx'::"text"])))
);


ALTER TABLE "compi_private"."arts_drive_originals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."arts_generated_drafts" (
    "author" "uuid" NOT NULL,
    "request_id" "uuid" NOT NULL,
    "hotel_key" "text" NOT NULL,
    "outlet_key" "text" NOT NULL,
    "guide_key" "text" NOT NULL,
    "fingerprint" "text" NOT NULL
);


ALTER TABLE "compi_private"."arts_generated_drafts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."arts_guide_classifications" (
    "hotel_key" "text" NOT NULL,
    "outlet_key" "text" NOT NULL,
    "guide_key" "text" NOT NULL,
    "kind" "text",
    "category" "text",
    CONSTRAINT "guide_classifications_category_check" CHECK (("category" = ANY (ARRAY['desayunos'::"text", 'entrantes'::"text", 'principales'::"text", 'postres'::"text", 'fondos'::"text", 'salsas'::"text", 'bases'::"text", 'guarniciones'::"text", 'otros'::"text"]))),
    CONSTRAINT "guide_classifications_kind_check" CHECK (("kind" = ANY (ARRAY['plato'::"text", 'elaboracion'::"text"])))
);


ALTER TABLE "compi_private"."arts_guide_classifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."arts_guide_costs" (
    "hotel_key" "text" NOT NULL,
    "outlet_key" "text" NOT NULL,
    "guide_key" "text" NOT NULL,
    "revision" "uuid" NOT NULL,
    "settings" "jsonb" NOT NULL
);


ALTER TABLE "compi_private"."arts_guide_costs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."arts_guide_reviews" (
    "user_id" "uuid" NOT NULL,
    "hotel_key" "text" NOT NULL,
    "outlet_key" "text" NOT NULL,
    "guide_key" "text" NOT NULL
);


ALTER TABLE "compi_private"."arts_guide_reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."arts_guide_sources" (
    "hotel_key" "text" NOT NULL,
    "outlet_key" "text" NOT NULL,
    "guide_key" "text" NOT NULL,
    "revision" "uuid" NOT NULL,
    "source" "jsonb" NOT NULL,
    "docx_sha" "text" NOT NULL,
    "pdf_sha" "text" NOT NULL
);


ALTER TABLE "compi_private"."arts_guide_sources" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."arts_image_labels" (
    "hotel_key" "text" NOT NULL,
    "outlet_key" "text" NOT NULL,
    "guide_key" "text" NOT NULL,
    "sha" "text" NOT NULL,
    "labels" "jsonb" NOT NULL,
    CONSTRAINT "arts_image_labels_sha_check" CHECK (("length"("sha") = 64))
);


ALTER TABLE "compi_private"."arts_image_labels" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."arts_validated_files" (
    "hotel_key" "text" NOT NULL,
    "outlet_key" "text" NOT NULL,
    "guide_key" "text" NOT NULL,
    "format" "text" NOT NULL,
    "digest" "text" NOT NULL,
    CONSTRAINT "validated_files_digest_check" CHECK (("digest" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "validated_files_format_check" CHECK (("format" = ANY (ARRAY['pdf'::"text", 'docx'::"text"])))
);


ALTER TABLE "compi_private"."arts_validated_files" OWNER TO "postgres";


CREATE OR REPLACE VIEW "compi_private"."arts_workspace_sources" AS
 SELECT "s"."hotel_key",
    "s"."outlet_key",
    "s"."guide_key",
    "s"."revision",
    ("s"."source" -> 'data'::"text") AS "data",
        CASE
            WHEN ((("s"."source" -> 'imagen_aprobada'::"text") ->> 'tipo'::"text") = ANY (ARRAY['foto'::"text", 'acuarela'::"text"])) THEN (("s"."source" -> 'imagen_aprobada'::"text") ->> 'tipo'::"text")
            ELSE NULL::"text"
        END AS "image_kind",
    (("s"."source" -> 'imagen_aprobada'::"text") ->> 'sha256'::"text") AS "approved_sha",
        CASE
            WHEN ((("s"."source" -> 'imagen_aprobada'::"text") ->> 'tipo'::"text") = 'acuarela'::"text") THEN ((("s"."source" -> 'assets'::"text") -> 'art'::"text") ->> 'sha256'::"text")
            ELSE NULL::"text"
        END AS "clean_sha"
   FROM (("compi_private"."arts_guide_sources" "s"
     JOIN "compi_private"."arts_validated_files" "w" ON ((("w"."hotel_key" = "s"."hotel_key") AND ("w"."outlet_key" = "s"."outlet_key") AND ("w"."guide_key" = "s"."guide_key") AND ("w"."format" = 'docx'::"text") AND ("w"."digest" = "s"."docx_sha"))))
     JOIN "compi_private"."arts_validated_files" "p" ON ((("p"."hotel_key" = "s"."hotel_key") AND ("p"."outlet_key" = "s"."outlet_key") AND ("p"."guide_key" = "s"."guide_key") AND ("p"."format" = 'pdf'::"text") AND ("p"."digest" = "s"."pdf_sha"))));


ALTER VIEW "compi_private"."arts_workspace_sources" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."auth_request_buckets" (
    "minute" timestamp with time zone NOT NULL,
    "endpoint" "text" NOT NULL,
    "client" "text" NOT NULL,
    "attempts" integer NOT NULL
);


ALTER TABLE "compi_private"."auth_request_buckets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."backup_codes" (
    "owner" "uuid" NOT NULL,
    "digest" "bytea" NOT NULL,
    "attempt" "uuid",
    "lease_until" timestamp with time zone,
    "original_fingerprint" "bytea"
);


ALTER TABLE "compi_private"."backup_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."document_brand_defaults" (
    "hotel_key" "text" NOT NULL,
    "accent" "text" NOT NULL,
    "logo_png" "text" NOT NULL
);


ALTER TABLE "compi_private"."document_brand_defaults" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."document_brands" (
    "hotel_key" "text" NOT NULL,
    "accent" "text" NOT NULL,
    "logo_png" "text",
    "revision" integer NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "document_brands_accent_check" CHECK (("accent" ~ '^[A-F0-9]{6}$'::"text")),
    CONSTRAINT "document_brands_logo_png_check" CHECK (("length"("logo_png") <= 349528)),
    CONSTRAINT "document_brands_revision_check" CHECK (("revision" > 0))
);


ALTER TABLE "compi_private"."document_brands" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."executive_password_only" (
    "employee_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "hotel_key" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "compi_private"."executive_password_only" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."generated_drafts" (
    "author" "uuid" NOT NULL,
    "request_id" "uuid" NOT NULL,
    "hotel_key" "text" NOT NULL,
    "outlet_key" "text" NOT NULL,
    "guide_key" "text" NOT NULL,
    "fingerprint" "text" NOT NULL
);


ALTER TABLE "compi_private"."generated_drafts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."guide_classifications" (
    "hotel_key" "text" NOT NULL,
    "outlet_key" "text" NOT NULL,
    "guide_key" "text" NOT NULL,
    "kind" "text",
    "category" "text",
    CONSTRAINT "guide_classifications_category_check" CHECK (("category" = ANY (ARRAY['entrantes'::"text", 'principales'::"text", 'postres'::"text", 'fondos'::"text", 'salsas'::"text", 'bases'::"text", 'guarniciones'::"text", 'otros'::"text"]))),
    CONSTRAINT "guide_classifications_kind_check" CHECK (("kind" = ANY (ARRAY['plato'::"text", 'elaboracion'::"text"])))
);


ALTER TABLE "compi_private"."guide_classifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."guide_costs" (
    "hotel_key" "text" NOT NULL,
    "outlet_key" "text" NOT NULL,
    "guide_key" "text" NOT NULL,
    "revision" "uuid" NOT NULL,
    "settings" "jsonb" NOT NULL
);


ALTER TABLE "compi_private"."guide_costs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."guide_reviews" (
    "user_id" "uuid" NOT NULL,
    "hotel_key" "text" NOT NULL,
    "outlet_key" "text" NOT NULL,
    "guide_key" "text" NOT NULL
);


ALTER TABLE "compi_private"."guide_reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."guide_sources" (
    "hotel_key" "text" NOT NULL,
    "outlet_key" "text" NOT NULL,
    "guide_key" "text" NOT NULL,
    "revision" "uuid" NOT NULL,
    "source" "jsonb" NOT NULL,
    "docx_sha" "text" NOT NULL,
    "pdf_sha" "text" NOT NULL
);


ALTER TABLE "compi_private"."guide_sources" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."hotel_codes" (
    "hotel_key" "text" NOT NULL,
    "code" "text" NOT NULL,
    CONSTRAINT "hotel_codes_code_check" CHECK (("code" ~ '^[a-z]{2,8}$'::"text"))
);


ALTER TABLE "compi_private"."hotel_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."lab_mail_outbox" (
    "employee" "uuid" NOT NULL,
    "recipient" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "attempt" "uuid",
    "lease_until" timestamp with time zone,
    "message" "text",
    "queued_at" timestamp with time zone,
    "relay_key_hash" "text",
    CONSTRAINT "lab_mail_outbox_recipient_check" CHECK (("recipient" ~ '^[a-z0-9._+-]+@compichef[.]com$'::"text"))
);


ALTER TABLE "compi_private"."lab_mail_outbox" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."lab_tickets" (
    "employee" "uuid" NOT NULL,
    "digest" "bytea" NOT NULL,
    "attempt" "uuid",
    "lease_until" timestamp with time zone
);


ALTER TABLE "compi_private"."lab_tickets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."mail_folders" (
    "owner" "uuid" NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "label" "text" NOT NULL,
    CONSTRAINT "mail_folders_label_check" CHECK ((("length"("btrim"("label")) >= 1) AND ("length"("btrim"("label")) <= 60)))
);


ALTER TABLE "compi_private"."mail_folders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."mail_items" (
    "owner" "uuid" NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "origin" "text" NOT NULL,
    "folder" "uuid",
    "starred" boolean DEFAULT false NOT NULL,
    "unread" boolean DEFAULT false NOT NULL,
    "sender" "text" NOT NULL,
    "recipients" "text" DEFAULT ''::"text" NOT NULL,
    "subject" "text" DEFAULT ''::"text" NOT NULL,
    "body" "text" DEFAULT ''::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "revision" integer DEFAULT 1 NOT NULL,
    CONSTRAINT "mail_items_origin_check" CHECK (("origin" = ANY (ARRAY['inbox'::"text", 'sent'::"text", 'drafts'::"text"])))
);


ALTER TABLE "compi_private"."mail_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."schedule_extra_outlets" (
    "employee" "uuid" NOT NULL,
    "hotel_key" "text" NOT NULL,
    "outlet_key" "text" NOT NULL
);


ALTER TABLE "compi_private"."schedule_extra_outlets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."schedule_hours" (
    "employee" "uuid" NOT NULL,
    "month" "date" NOT NULL,
    "minutes" integer NOT NULL,
    "revision" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    CONSTRAINT "schedule_hours_month_check" CHECK ((EXTRACT("day" FROM "month") = (1)::numeric))
);


ALTER TABLE "compi_private"."schedule_hours" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."schedule_leave" (
    "id" "uuid" NOT NULL,
    "employee" "uuid" NOT NULL,
    "days" "date"[] NOT NULL,
    "state" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "decided_at" timestamp with time zone,
    "decided_by" "uuid",
    CONSTRAINT "schedule_leave_days_check" CHECK (("cardinality"("days") > 0)),
    CONSTRAINT "schedule_leave_state_check" CHECK (("state" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "compi_private"."schedule_leave" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."schedule_shifts" (
    "employee" "uuid" NOT NULL,
    "day" "date" NOT NULL,
    "kind" "text" NOT NULL,
    "starts" time without time zone,
    "ends" time without time zone,
    "revision" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    CONSTRAINT "schedule_shifts_check" CHECK (((("kind" = 'off'::"text") AND ("starts" IS NULL) AND ("ends" IS NULL)) OR (("kind" = 'work'::"text") AND ("starts" IS NOT NULL) AND ("ends" IS NOT NULL) AND ("starts" <> "ends")))),
    CONSTRAINT "schedule_shifts_kind_check" CHECK (("kind" = ANY (ARRAY['work'::"text", 'off'::"text"])))
);


ALTER TABLE "compi_private"."schedule_shifts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "compi_private"."validated_files" (
    "hotel_key" "text" NOT NULL,
    "outlet_key" "text" NOT NULL,
    "guide_key" "text" NOT NULL,
    "format" "text" NOT NULL,
    "digest" "text" NOT NULL,
    CONSTRAINT "validated_files_digest_check" CHECK (("digest" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "validated_files_format_check" CHECK (("format" = ANY (ARRAY['pdf'::"text", 'docx'::"text"])))
);


ALTER TABLE "compi_private"."validated_files" OWNER TO "postgres";


CREATE OR REPLACE VIEW "compi_private"."workspace_sources" AS
 SELECT "s"."hotel_key",
    "s"."outlet_key",
    "s"."guide_key",
    "s"."revision",
    ("s"."source" -> 'data'::"text") AS "data",
        CASE
            WHEN ((("s"."source" -> 'imagen_aprobada'::"text") ->> 'tipo'::"text") = ANY (ARRAY['foto'::"text", 'acuarela'::"text"])) THEN (("s"."source" -> 'imagen_aprobada'::"text") ->> 'tipo'::"text")
            ELSE NULL::"text"
        END AS "image_kind",
    (("s"."source" -> 'imagen_aprobada'::"text") ->> 'sha256'::"text") AS "approved_sha",
        CASE
            WHEN ((("s"."source" -> 'imagen_aprobada'::"text") ->> 'tipo'::"text") = 'acuarela'::"text") THEN ((("s"."source" -> 'assets'::"text") -> 'art'::"text") ->> 'sha256'::"text")
            ELSE NULL::"text"
        END AS "clean_sha"
   FROM (("compi_private"."guide_sources" "s"
     JOIN "compi_private"."validated_files" "w" ON ((("w"."hotel_key" = "s"."hotel_key") AND ("w"."outlet_key" = "s"."outlet_key") AND ("w"."guide_key" = "s"."guide_key") AND ("w"."format" = 'docx'::"text") AND ("w"."digest" = "s"."docx_sha"))))
     JOIN "compi_private"."validated_files" "p" ON ((("p"."hotel_key" = "s"."hotel_key") AND ("p"."outlet_key" = "s"."outlet_key") AND ("p"."guide_key" = "s"."guide_key") AND ("p"."format" = 'pdf'::"text") AND ("p"."digest" = "s"."pdf_sha"))));


ALTER VIEW "compi_private"."workspace_sources" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."compi_arts_guides" (
    "hotel_key" "text" NOT NULL,
    "outlet_key" "text" NOT NULL,
    "guide_key" "text" NOT NULL,
    "hotel" "text" NOT NULL,
    "outlet" "text" NOT NULL,
    "title" "text" NOT NULL,
    "object_prefix" "text" GENERATED ALWAYS AS (((((("hotel_key" || '/'::"text") || "outlet_key") || '/plating-guides/'::"text") || "guide_key") || '/'::"text")) STORED,
    "guide_state" "text" DEFAULT 'ready'::"text" NOT NULL,
    "created_by" "uuid",
    CONSTRAINT "compi_guides_guide_key_check" CHECK (("guide_key" ~ '^[a-z0-9-]+$'::"text")),
    CONSTRAINT "compi_guides_guide_state_check" CHECK (("guide_state" = ANY (ARRAY['draft'::"text", 'ready'::"text", 'archived'::"text"]))),
    CONSTRAINT "compi_guides_hotel_key_check" CHECK (("hotel_key" ~ '^[a-z0-9-]+$'::"text")),
    CONSTRAINT "compi_guides_outlet_key_check" CHECK (("outlet_key" ~ '^[a-z0-9-]+$'::"text"))
);


ALTER TABLE "public"."compi_arts_guides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."compi_arts_outlets" (
    "hotel_key" "text" NOT NULL,
    "outlet_key" "text" NOT NULL,
    "hotel" "text" NOT NULL,
    "outlet" "text" NOT NULL,
    "archived" boolean DEFAULT false NOT NULL,
    CONSTRAINT "compi_outlets_outlet_check" CHECK ((("length"("btrim"("outlet")) >= 1) AND ("length"("btrim"("outlet")) <= 120)))
);


ALTER TABLE "public"."compi_arts_outlets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."compi_guides" (
    "hotel_key" "text" NOT NULL,
    "outlet_key" "text" NOT NULL,
    "guide_key" "text" NOT NULL,
    "hotel" "text" NOT NULL,
    "outlet" "text" NOT NULL,
    "title" "text" NOT NULL,
    "object_prefix" "text" GENERATED ALWAYS AS (((((("hotel_key" || '/'::"text") || "outlet_key") || '/plating-guides/'::"text") || "guide_key") || '/'::"text")) STORED,
    "guide_state" "text" DEFAULT 'ready'::"text" NOT NULL,
    "created_by" "uuid",
    CONSTRAINT "compi_guides_guide_key_check" CHECK (("guide_key" ~ '^[a-z0-9-]+$'::"text")),
    CONSTRAINT "compi_guides_guide_state_check" CHECK (("guide_state" = ANY (ARRAY['draft'::"text", 'ready'::"text", 'archived'::"text"]))),
    CONSTRAINT "compi_guides_hotel_key_check" CHECK (("hotel_key" ~ '^[a-z0-9-]+$'::"text")),
    CONSTRAINT "compi_guides_outlet_key_check" CHECK (("outlet_key" ~ '^[a-z0-9-]+$'::"text"))
);


ALTER TABLE "public"."compi_guides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."compi_memberships" (
    "user_id" "uuid" NOT NULL,
    "hotel_key" "text" NOT NULL,
    CONSTRAINT "compi_memberships_hotel_key_check" CHECK (("hotel_key" ~ '^[a-z0-9-]+$'::"text"))
);


ALTER TABLE "public"."compi_memberships" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."compi_outlets" (
    "hotel_key" "text" NOT NULL,
    "outlet_key" "text" NOT NULL,
    "hotel" "text" NOT NULL,
    "outlet" "text" NOT NULL,
    "archived" boolean DEFAULT false NOT NULL,
    CONSTRAINT "compi_outlets_outlet_check" CHECK ((("length"("btrim"("outlet")) >= 1) AND ("length"("btrim"("outlet")) <= 120)))
);


ALTER TABLE "public"."compi_outlets" OWNER TO "postgres";


ALTER TABLE ONLY "compi_private"."account_creations"
    ADD CONSTRAINT "account_creations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "compi_private"."acuarela_master_chunks"
    ADD CONSTRAINT "acuarela_master_chunks_pkey" PRIMARY KEY ("part");



ALTER TABLE ONLY "compi_private"."address_allocations"
    ADD CONSTRAINT "address_allocations_address_key" UNIQUE ("address");



ALTER TABLE ONLY "compi_private"."address_allocations"
    ADD CONSTRAINT "address_allocations_pkey" PRIMARY KEY ("request_id");



ALTER TABLE ONLY "compi_private"."arts_drive_originals"
    ADD CONSTRAINT "arts_drive_originals_drive_id_key" UNIQUE ("drive_id");



ALTER TABLE ONLY "compi_private"."arts_drive_originals"
    ADD CONSTRAINT "arts_drive_originals_pkey" PRIMARY KEY ("hotel_key", "outlet_key", "guide_key", "format");



ALTER TABLE ONLY "compi_private"."arts_generated_drafts"
    ADD CONSTRAINT "arts_generated_drafts_pkey" PRIMARY KEY ("author", "request_id");



ALTER TABLE ONLY "compi_private"."arts_guide_classifications"
    ADD CONSTRAINT "arts_guide_classifications_pkey" PRIMARY KEY ("hotel_key", "outlet_key", "guide_key");



ALTER TABLE ONLY "compi_private"."arts_guide_costs"
    ADD CONSTRAINT "arts_guide_costs_pkey" PRIMARY KEY ("hotel_key", "outlet_key", "guide_key");



ALTER TABLE ONLY "compi_private"."arts_guide_reviews"
    ADD CONSTRAINT "arts_guide_reviews_pkey" PRIMARY KEY ("user_id", "hotel_key", "outlet_key", "guide_key");



ALTER TABLE ONLY "compi_private"."arts_guide_sources"
    ADD CONSTRAINT "arts_guide_sources_pkey" PRIMARY KEY ("hotel_key", "outlet_key", "guide_key");



ALTER TABLE ONLY "compi_private"."arts_image_labels"
    ADD CONSTRAINT "arts_image_labels_pkey" PRIMARY KEY ("hotel_key", "outlet_key", "guide_key");



ALTER TABLE ONLY "compi_private"."arts_validated_files"
    ADD CONSTRAINT "arts_validated_files_pkey" PRIMARY KEY ("hotel_key", "outlet_key", "guide_key", "format");



ALTER TABLE ONLY "compi_private"."auth_request_buckets"
    ADD CONSTRAINT "auth_request_buckets_pkey" PRIMARY KEY ("minute", "endpoint", "client");



ALTER TABLE ONLY "compi_private"."backup_codes"
    ADD CONSTRAINT "backup_codes_digest_key" UNIQUE ("digest");



ALTER TABLE ONLY "compi_private"."backup_codes"
    ADD CONSTRAINT "backup_codes_pkey" PRIMARY KEY ("owner");



ALTER TABLE ONLY "compi_private"."document_brand_defaults"
    ADD CONSTRAINT "document_brand_defaults_pkey" PRIMARY KEY ("hotel_key");



ALTER TABLE ONLY "compi_private"."document_brands"
    ADD CONSTRAINT "document_brands_pkey" PRIMARY KEY ("hotel_key");



ALTER TABLE ONLY "compi_private"."executive_password_only"
    ADD CONSTRAINT "executive_password_only_pkey" PRIMARY KEY ("employee_id");



ALTER TABLE ONLY "compi_private"."generated_drafts"
    ADD CONSTRAINT "generated_drafts_pkey" PRIMARY KEY ("author", "request_id");



ALTER TABLE ONLY "compi_private"."guide_classifications"
    ADD CONSTRAINT "guide_classifications_pkey" PRIMARY KEY ("hotel_key", "outlet_key", "guide_key");



ALTER TABLE ONLY "compi_private"."guide_costs"
    ADD CONSTRAINT "guide_costs_pkey" PRIMARY KEY ("hotel_key", "outlet_key", "guide_key");



ALTER TABLE ONLY "compi_private"."guide_reviews"
    ADD CONSTRAINT "guide_reviews_pkey" PRIMARY KEY ("user_id", "hotel_key", "outlet_key", "guide_key");



ALTER TABLE ONLY "compi_private"."guide_sources"
    ADD CONSTRAINT "guide_sources_pkey" PRIMARY KEY ("hotel_key", "outlet_key", "guide_key");



ALTER TABLE ONLY "compi_private"."hotel_codes"
    ADD CONSTRAINT "hotel_codes_code_key" UNIQUE ("code");



ALTER TABLE ONLY "compi_private"."hotel_codes"
    ADD CONSTRAINT "hotel_codes_pkey" PRIMARY KEY ("hotel_key");



ALTER TABLE ONLY "compi_private"."lab_mail_outbox"
    ADD CONSTRAINT "lab_mail_outbox_pkey" PRIMARY KEY ("employee");



ALTER TABLE ONLY "compi_private"."lab_mail_outbox"
    ADD CONSTRAINT "lab_mail_outbox_recipient_key" UNIQUE ("recipient");



ALTER TABLE ONLY "compi_private"."lab_tickets"
    ADD CONSTRAINT "lab_tickets_digest_key" UNIQUE ("digest");



ALTER TABLE ONLY "compi_private"."lab_tickets"
    ADD CONSTRAINT "lab_tickets_pkey" PRIMARY KEY ("employee");



ALTER TABLE ONLY "compi_private"."mail_folders"
    ADD CONSTRAINT "mail_folders_pkey" PRIMARY KEY ("owner", "id");



ALTER TABLE ONLY "compi_private"."mail_items"
    ADD CONSTRAINT "mail_items_pkey" PRIMARY KEY ("owner", "id");



ALTER TABLE ONLY "compi_private"."schedule_extra_outlets"
    ADD CONSTRAINT "schedule_extra_outlets_pkey" PRIMARY KEY ("employee", "hotel_key", "outlet_key");



ALTER TABLE ONLY "compi_private"."schedule_hours"
    ADD CONSTRAINT "schedule_hours_pkey" PRIMARY KEY ("employee", "month");



ALTER TABLE ONLY "compi_private"."schedule_leave"
    ADD CONSTRAINT "schedule_leave_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "compi_private"."schedule_shifts"
    ADD CONSTRAINT "schedule_shifts_pkey" PRIMARY KEY ("employee", "day");



ALTER TABLE ONLY "compi_private"."validated_files"
    ADD CONSTRAINT "validated_files_pkey" PRIMARY KEY ("hotel_key", "outlet_key", "guide_key", "format");



ALTER TABLE ONLY "public"."compi_arts_guides"
    ADD CONSTRAINT "compi_arts_guides_pkey" PRIMARY KEY ("hotel_key", "outlet_key", "guide_key");



ALTER TABLE ONLY "public"."compi_arts_outlets"
    ADD CONSTRAINT "compi_arts_outlets_pkey" PRIMARY KEY ("hotel_key", "outlet_key");



ALTER TABLE ONLY "public"."compi_guides"
    ADD CONSTRAINT "compi_guides_pkey" PRIMARY KEY ("hotel_key", "outlet_key", "guide_key");



ALTER TABLE ONLY "public"."compi_memberships"
    ADD CONSTRAINT "compi_memberships_pkey" PRIMARY KEY ("user_id", "hotel_key");



ALTER TABLE ONLY "public"."compi_outlets"
    ADD CONSTRAINT "compi_outlets_pkey" PRIMARY KEY ("hotel_key", "outlet_key");



ALTER TABLE ONLY "public"."compi_staff"
    ADD CONSTRAINT "compi_staff_hotel_key_email_key" UNIQUE ("hotel_key", "email");



ALTER TABLE ONLY "public"."compi_staff"
    ADD CONSTRAINT "compi_staff_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."compi_staff"
    ADD CONSTRAINT "compi_staff_user_id_hotel_key_key" UNIQUE ("user_id", "hotel_key");



CREATE INDEX "access_events_time" ON "compi_private"."access_events" USING "btree" ("occurred_at");



CREATE UNIQUE INDEX "mail_folder_label" ON "compi_private"."mail_folders" USING "btree" ("owner", "lower"("label"));



CREATE INDEX "mail_items_location" ON "compi_private"."mail_items" USING "btree" ("owner", "folder", "origin", "updated_at" DESC, "id");



CREATE INDEX "mail_items_stars" ON "compi_private"."mail_items" USING "btree" ("owner", "updated_at" DESC, "id") WHERE "starred";



CREATE INDEX "schedule_extra_by_outlet" ON "compi_private"."schedule_extra_outlets" USING "btree" ("hotel_key", "outlet_key");



CREATE INDEX "schedule_leave_employee" ON "compi_private"."schedule_leave" USING "btree" ("employee", "state");



CREATE UNIQUE INDEX "compi_arts_outlets_hotel_key_lower_idx" ON "public"."compi_arts_outlets" USING "btree" ("hotel_key", "lower"("outlet")) WHERE (NOT "archived");



CREATE UNIQUE INDEX "compi_outlets_display" ON "public"."compi_outlets" USING "btree" ("hotel_key", "lower"("outlet")) WHERE (NOT "archived");



CREATE UNIQUE INDEX "compi_pending_lab_email" ON "public"."compi_staff" USING "btree" ("email") WHERE (("user_id" IS NULL) AND ("email" ~~ '%@compi.invalid'::"text"));



CREATE INDEX "compi_staff_email_pending" ON "public"."compi_staff" USING "btree" ("email") WHERE ("user_id" IS NULL);



CREATE OR REPLACE TRIGGER "compi_minimize_allocation" AFTER DELETE ON "public"."compi_staff" FOR EACH ROW EXECUTE FUNCTION "compi_private"."minimize_allocation"();



CREATE OR REPLACE TRIGGER "compi_record_staff_event" AFTER INSERT OR DELETE OR UPDATE ON "public"."compi_staff" FOR EACH ROW EXECUTE FUNCTION "compi_private"."record_staff_event"();



ALTER TABLE ONLY "compi_private"."arts_drive_originals"
    ADD CONSTRAINT "arts_drive_originals_hotel_key_outlet_key_guide_key_fkey" FOREIGN KEY ("hotel_key", "outlet_key", "guide_key") REFERENCES "public"."compi_arts_guides"("hotel_key", "outlet_key", "guide_key") ON DELETE CASCADE;



ALTER TABLE ONLY "compi_private"."arts_generated_drafts"
    ADD CONSTRAINT "arts_generated_drafts_hotel_key_outlet_key_guide_key_fkey" FOREIGN KEY ("hotel_key", "outlet_key", "guide_key") REFERENCES "public"."compi_arts_guides"("hotel_key", "outlet_key", "guide_key") ON DELETE CASCADE;



ALTER TABLE ONLY "compi_private"."arts_guide_classifications"
    ADD CONSTRAINT "arts_guide_classifications_hotel_key_outlet_key_guide_key_fkey" FOREIGN KEY ("hotel_key", "outlet_key", "guide_key") REFERENCES "public"."compi_arts_guides"("hotel_key", "outlet_key", "guide_key") ON DELETE CASCADE;



ALTER TABLE ONLY "compi_private"."arts_guide_costs"
    ADD CONSTRAINT "arts_guide_costs_hotel_key_outlet_key_guide_key_fkey" FOREIGN KEY ("hotel_key", "outlet_key", "guide_key") REFERENCES "public"."compi_arts_guides"("hotel_key", "outlet_key", "guide_key") ON DELETE CASCADE;



ALTER TABLE ONLY "compi_private"."arts_guide_reviews"
    ADD CONSTRAINT "arts_guide_reviews_hotel_key_outlet_key_guide_key_fkey" FOREIGN KEY ("hotel_key", "outlet_key", "guide_key") REFERENCES "public"."compi_arts_guides"("hotel_key", "outlet_key", "guide_key") ON DELETE CASCADE;



ALTER TABLE ONLY "compi_private"."arts_guide_reviews"
    ADD CONSTRAINT "arts_guide_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "compi_private"."arts_guide_sources"
    ADD CONSTRAINT "arts_guide_sources_hotel_key_outlet_key_guide_key_fkey" FOREIGN KEY ("hotel_key", "outlet_key", "guide_key") REFERENCES "public"."compi_arts_guides"("hotel_key", "outlet_key", "guide_key") ON DELETE CASCADE;



ALTER TABLE ONLY "compi_private"."arts_validated_files"
    ADD CONSTRAINT "arts_validated_files_hotel_key_outlet_key_guide_key_fkey" FOREIGN KEY ("hotel_key", "outlet_key", "guide_key") REFERENCES "public"."compi_arts_guides"("hotel_key", "outlet_key", "guide_key") ON DELETE CASCADE;



ALTER TABLE ONLY "compi_private"."backup_codes"
    ADD CONSTRAINT "backup_codes_owner_fkey" FOREIGN KEY ("owner") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "compi_private"."executive_password_only"
    ADD CONSTRAINT "executive_password_only_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."compi_staff"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "compi_private"."executive_password_only"
    ADD CONSTRAINT "executive_password_only_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "compi_private"."generated_drafts"
    ADD CONSTRAINT "generated_drafts_hotel_key_outlet_key_guide_key_fkey" FOREIGN KEY ("hotel_key", "outlet_key", "guide_key") REFERENCES "public"."compi_guides"("hotel_key", "outlet_key", "guide_key") ON DELETE CASCADE;



ALTER TABLE ONLY "compi_private"."guide_classifications"
    ADD CONSTRAINT "guide_classifications_hotel_key_outlet_key_guide_key_fkey" FOREIGN KEY ("hotel_key", "outlet_key", "guide_key") REFERENCES "public"."compi_guides"("hotel_key", "outlet_key", "guide_key") ON DELETE CASCADE;



ALTER TABLE ONLY "compi_private"."guide_costs"
    ADD CONSTRAINT "guide_costs_hotel_key_outlet_key_guide_key_fkey" FOREIGN KEY ("hotel_key", "outlet_key", "guide_key") REFERENCES "public"."compi_guides"("hotel_key", "outlet_key", "guide_key") ON DELETE CASCADE;



ALTER TABLE ONLY "compi_private"."guide_reviews"
    ADD CONSTRAINT "guide_reviews_hotel_key_outlet_key_guide_key_fkey" FOREIGN KEY ("hotel_key", "outlet_key", "guide_key") REFERENCES "public"."compi_guides"("hotel_key", "outlet_key", "guide_key") ON DELETE CASCADE;



ALTER TABLE ONLY "compi_private"."guide_reviews"
    ADD CONSTRAINT "guide_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "compi_private"."guide_sources"
    ADD CONSTRAINT "guide_sources_hotel_key_outlet_key_guide_key_fkey" FOREIGN KEY ("hotel_key", "outlet_key", "guide_key") REFERENCES "public"."compi_guides"("hotel_key", "outlet_key", "guide_key") ON DELETE CASCADE;



ALTER TABLE ONLY "compi_private"."lab_mail_outbox"
    ADD CONSTRAINT "lab_mail_outbox_employee_fkey" FOREIGN KEY ("employee") REFERENCES "public"."compi_staff"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "compi_private"."lab_tickets"
    ADD CONSTRAINT "lab_tickets_employee_fkey" FOREIGN KEY ("employee") REFERENCES "public"."compi_staff"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "compi_private"."mail_folders"
    ADD CONSTRAINT "mail_folders_owner_fkey" FOREIGN KEY ("owner") REFERENCES "public"."compi_staff"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "compi_private"."mail_items"
    ADD CONSTRAINT "mail_items_owner_fkey" FOREIGN KEY ("owner") REFERENCES "public"."compi_staff"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "compi_private"."mail_items"
    ADD CONSTRAINT "mail_items_owner_folder_fkey" FOREIGN KEY ("owner", "folder") REFERENCES "compi_private"."mail_folders"("owner", "id") ON DELETE SET NULL ("folder");



ALTER TABLE ONLY "compi_private"."schedule_extra_outlets"
    ADD CONSTRAINT "schedule_extra_outlets_employee_fkey" FOREIGN KEY ("employee") REFERENCES "public"."compi_staff"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "compi_private"."schedule_extra_outlets"
    ADD CONSTRAINT "schedule_extra_outlets_hotel_key_outlet_key_fkey" FOREIGN KEY ("hotel_key", "outlet_key") REFERENCES "public"."compi_outlets"("hotel_key", "outlet_key") ON DELETE CASCADE;



ALTER TABLE ONLY "compi_private"."schedule_hours"
    ADD CONSTRAINT "schedule_hours_employee_fkey" FOREIGN KEY ("employee") REFERENCES "public"."compi_staff"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "compi_private"."schedule_leave"
    ADD CONSTRAINT "schedule_leave_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "public"."compi_staff"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "compi_private"."schedule_leave"
    ADD CONSTRAINT "schedule_leave_employee_fkey" FOREIGN KEY ("employee") REFERENCES "public"."compi_staff"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "compi_private"."schedule_shifts"
    ADD CONSTRAINT "schedule_shifts_employee_fkey" FOREIGN KEY ("employee") REFERENCES "public"."compi_staff"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "compi_private"."validated_files"
    ADD CONSTRAINT "validated_files_hotel_key_outlet_key_guide_key_fkey" FOREIGN KEY ("hotel_key", "outlet_key", "guide_key") REFERENCES "public"."compi_guides"("hotel_key", "outlet_key", "guide_key") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."compi_arts_guides"
    ADD CONSTRAINT "compi_arts_guides_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."compi_guides"
    ADD CONSTRAINT "compi_guides_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."compi_memberships"
    ADD CONSTRAINT "compi_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."compi_staff"
    ADD CONSTRAINT "compi_staff_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE "compi_private"."access_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "compi_private"."account_creations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "compi_private"."acuarela_master_chunks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "compi_private"."address_allocations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "compi_private"."arts_drive_originals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "compi_private"."arts_generated_drafts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "compi_private"."arts_guide_classifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "compi_private"."arts_guide_costs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "compi_private"."arts_guide_reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "compi_private"."arts_guide_sources" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "compi_private"."arts_image_labels" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "compi_private"."arts_validated_files" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "compi_private"."auth_request_buckets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "compi_private"."backup_codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "compi_private"."document_brand_defaults" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "compi_private"."document_brands" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "compi_private"."executive_password_only" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "compi_private"."generated_drafts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "compi_private"."guide_classifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "compi_private"."guide_costs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "compi_private"."guide_reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "compi_private"."guide_sources" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "compi_private"."hotel_codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "compi_private"."lab_mail_outbox" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "compi_private"."lab_tickets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "compi_private"."mail_folders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "compi_private"."mail_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "compi_private"."schedule_extra_outlets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "compi_private"."schedule_hours" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "compi_private"."schedule_leave" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "compi_private"."schedule_shifts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "compi_private"."validated_files" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."compi_arts_guides" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."compi_arts_outlets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."compi_guides" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."compi_memberships" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."compi_outlets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."compi_staff" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "hotel_outlets_read" ON "public"."compi_arts_outlets" FOR SELECT TO "authenticated" USING ((( SELECT "compi_private"."active_download_session"() AS "active_download_session") AND ((NOT "archived") AND (("compi_private"."my_rank"("hotel_key") >= 1) AND ("compi_private"."my_rank"("hotel_key") <= 3)))));



CREATE POLICY "hotel_outlets_read" ON "public"."compi_outlets" FOR SELECT TO "authenticated" USING (((NOT "archived") AND (("compi_private"."my_rank"("hotel_key") >= 1) AND ("compi_private"."my_rank"("hotel_key") <= 3))));



CREATE POLICY "membership_current_session" ON "public"."compi_memberships" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (( SELECT "compi_private"."active_download_session"() AS "active_download_session"));



CREATE POLICY "read_hotel_guides" ON "public"."compi_arts_guides" FOR SELECT TO "authenticated" USING ((( SELECT "compi_private"."active_download_session"() AS "active_download_session") AND (("compi_private"."my_rank"("hotel_key") >= 1) AND ("compi_private"."my_rank"("hotel_key") <= 3) AND (EXISTS ( SELECT 1
   FROM "public"."compi_arts_outlets" "o"
  WHERE (("o"."hotel_key" = "compi_arts_guides"."hotel_key") AND ("o"."outlet_key" = "compi_arts_guides"."outlet_key") AND (NOT "o"."archived")))) AND (("guide_state" = 'ready'::"text") OR (("guide_state" = 'draft'::"text") AND (("created_by" = ( SELECT "auth"."uid"() AS "uid")) OR ("compi_private"."my_rank"("hotel_key") = 1)))))));



CREATE POLICY "read_hotel_guides" ON "public"."compi_guides" FOR SELECT TO "authenticated" USING (((("compi_private"."my_rank"("hotel_key") >= 1) AND ("compi_private"."my_rank"("hotel_key") <= 3)) AND (EXISTS ( SELECT 1
   FROM "public"."compi_outlets" "o"
  WHERE (("o"."hotel_key" = "compi_guides"."hotel_key") AND ("o"."outlet_key" = "compi_guides"."outlet_key") AND (NOT "o"."archived")))) AND (("guide_state" = 'ready'::"text") OR (("guide_state" = 'draft'::"text") AND (("created_by" = ( SELECT "auth"."uid"() AS "uid")) OR ("compi_private"."my_rank"("hotel_key") = 1))))));



CREATE POLICY "read_own_hotel_memberships" ON "public"."compi_memberships" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "staff_current_session" ON "public"."compi_staff" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (( SELECT "compi_private"."active_download_session"() AS "active_download_session"));



CREATE POLICY "staff_visibility" ON "public"."compi_staff" FOR SELECT TO "authenticated" USING ((("compi_private"."my_rank"("hotel_key") = 1) OR (("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("withdrawn_at" IS NULL))));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "compi_private" TO "authenticated";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "compi_private"."active_download_session"() FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."active_download_session"() TO "authenticated";



REVOKE ALL ON FUNCTION "compi_private"."arts_catalog_change"("h" "text", "o" "text", "g" "text", "op" "text", "label" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."arts_catalog_change"("h" "text", "o" "text", "g" "text", "op" "text", "label" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "compi_private"."arts_commit_file"("h" "text", "o" "text", "g" "text", "fmt" "text", "sha" "text", "previous" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."arts_commit_file"("h" "text", "o" "text", "g" "text", "fmt" "text", "sha" "text", "previous" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "compi_private"."arts_file_access"("h" "text", "o" "text", "g" "text", "fmt" "text", "editing" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."arts_file_access"("h" "text", "o" "text", "g" "text", "fmt" "text", "editing" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "compi_private"."arts_guide_source"("h" "text", "o" "text", "g" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."arts_guide_source"("h" "text", "o" "text", "g" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "compi_private"."arts_reserve_generated_draft"("h" "text", "o" "text", "ticket" "uuid", "label" "text", "fingerprint" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."arts_reserve_generated_draft"("h" "text", "o" "text", "ticket" "uuid", "label" "text", "fingerprint" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "compi_private"."arts_save_guide_source"("h" "text", "o" "text", "g" "text", "source" "jsonb", "docx" "text", "pdf" "text", "previous" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."arts_save_guide_source"("h" "text", "o" "text", "g" "text", "source" "jsonb", "docx" "text", "pdf" "text", "previous" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "compi_private"."arts_workspace_access"("h" "text", "o" "text", "g" "text", "writing" boolean) FROM PUBLIC;



REVOKE ALL ON FUNCTION "compi_private"."can_write_file"("path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."can_write_file"("path" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "compi_private"."catalog_change"("h" "text", "o" "text", "g" "text", "op" "text", "label" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."catalog_change"("h" "text", "o" "text", "g" "text", "op" "text", "label" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "compi_private"."commit_file"("h" "text", "o" "text", "g" "text", "fmt" "text", "sha" "text", "previous" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."commit_file"("h" "text", "o" "text", "g" "text", "fmt" "text", "sha" "text", "previous" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "compi_private"."compi_workspace_catalog"("after_h" "text", "after_o" "text", "after_g" "text", "batch" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."compi_workspace_catalog"("after_h" "text", "after_o" "text", "after_g" "text", "batch" integer) TO "service_role";



REVOKE ALL ON FUNCTION "compi_private"."cost_number"("v" "jsonb", "maximum" numeric, "places" integer, "nullable" boolean) FROM PUBLIC;



REVOKE ALL ON FUNCTION "compi_private"."delete_withdrawn_employee"("h" "text", "employee" "uuid", "withdrawal" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."delete_withdrawn_employee"("h" "text", "employee" "uuid", "withdrawal" timestamp with time zone) TO "authenticated";



REVOKE ALL ON FUNCTION "compi_private"."document_brand"("h" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."document_brand"("h" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "compi_private"."document_brand_revision"("h" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."document_brand_revision"("h" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "compi_private"."file_access"("h" "text", "o" "text", "g" "text", "fmt" "text", "editing" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."file_access"("h" "text", "o" "text", "g" "text", "fmt" "text", "editing" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "compi_private"."finish_lab_identity"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "compi_private"."finish_recovery"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "compi_private"."guide_source"("h" "text", "o" "text", "g" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."guide_source"("h" "text", "o" "text", "g" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "compi_private"."has_lab_account"("uid" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "compi_private"."lab_invitee"("h" "text", "employee" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."lab_invitee"("h" "text", "employee" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "compi_private"."mail_change"("h" "text", "op" "text", "data" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."mail_change"("h" "text", "op" "text", "data" "jsonb") TO "authenticated";



GRANT ALL ON TABLE "public"."compi_staff" TO "service_role";
GRANT SELECT ON TABLE "public"."compi_staff" TO "authenticated";



REVOKE ALL ON FUNCTION "compi_private"."mail_owner"("h" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "compi_private"."mail_read"("h" "text", "box" "text", "p" integer, "item" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."mail_read"("h" "text", "box" "text", "p" integer, "item" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "compi_private"."minimize_allocation"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "compi_private"."must_change_password"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "compi_private"."my_rank"("h" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."my_rank"("h" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "compi_private"."personal_backup"("issue" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."personal_backup"("issue" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "compi_private"."record_staff_event"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "compi_private"."register_address"("h" "text", "request_id" "uuid", "given_name" "text", "surname" "text", "position_name" "text", "outlet_name" "text", "access_rank" smallint) FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."register_address"("h" "text", "request_id" "uuid", "given_name" "text", "surname" "text", "position_name" "text", "outlet_name" "text", "access_rank" smallint) TO "authenticated";



REVOKE ALL ON FUNCTION "compi_private"."remove_pending_employee"("h" "text", "employee" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."remove_pending_employee"("h" "text", "employee" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "compi_private"."reserve_generated_draft"("h" "text", "o" "text", "ticket" "uuid", "label" "text", "fingerprint" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."reserve_generated_draft"("h" "text", "o" "text", "ticket" "uuid", "label" "text", "fingerprint" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "compi_private"."save_guide_source"("h" "text", "o" "text", "g" "text", "source" "jsonb", "docx" "text", "pdf" "text", "previous" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."save_guide_source"("h" "text", "o" "text", "g" "text", "source" "jsonb", "docx" "text", "pdf" "text", "previous" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "compi_private"."schedule_balance"("h" "text", "employee_id" "uuid", "month_start" "date", "adjustment" integer, "previous" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."schedule_balance"("h" "text", "employee_id" "uuid", "month_start" "date", "adjustment" integer, "previous" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "compi_private"."schedule_decide"("h" "text", "request_id" "uuid", "decision" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."schedule_decide"("h" "text", "request_id" "uuid", "decision" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "compi_private"."schedule_edit"("h" "text", "employee_id" "uuid", "work_day" "date", "kind" "text", "start_time" time without time zone, "end_time" time without time zone, "previous" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."schedule_edit"("h" "text", "employee_id" "uuid", "work_day" "date", "kind" "text", "start_time" time without time zone, "end_time" time without time zone, "previous" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "compi_private"."schedule_member"("h" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "compi_private"."schedule_request"("h" "text", "request_id" "uuid", "requested" "date"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."schedule_request"("h" "text", "request_id" "uuid", "requested" "date"[]) TO "authenticated";



REVOKE ALL ON FUNCTION "compi_private"."schedule_view"("h" "text", "month_start" "date", "department" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."schedule_view"("h" "text", "month_start" "date", "department" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "compi_private"."set_staff_access"("h" "text", "employee" "uuid", "enabled" boolean, "expected_rank" smallint) FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."set_staff_access"("h" "text", "employee" "uuid", "enabled" boolean, "expected_rank" smallint) TO "authenticated";



REVOKE ALL ON FUNCTION "compi_private"."staff_change"("h" "text", "op" "text", "item" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "compi_private"."staff_change"("h" "text", "op" "text", "item" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "compi_private"."workspace_access"("h" "text", "o" "text", "g" "text", "writing" boolean) FROM PUBLIC;



REVOKE ALL ON FUNCTION "compi_private"."workspace_data"("d" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "compi_private"."workspace_text"("d" "jsonb", "k" "text", "maximum" integer) FROM PUBLIC;






















































































































































REVOKE ALL ON FUNCTION "public"."compi_activate_access"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_activate_access"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_activate_access"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_activate_executive"("employee" "uuid", "uid" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_activate_executive"("employee" "uuid", "uid" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_acuarela_master"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_acuarela_master"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_allow_auth_request"("endpoint" "text", "client" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_allow_auth_request"("endpoint" "text", "client" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_arts_catalog_change"("h" "text", "o" "text", "g" "text", "op" "text", "label" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_arts_catalog_change"("h" "text", "o" "text", "g" "text", "op" "text", "label" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_arts_catalog_change"("h" "text", "o" "text", "g" "text", "op" "text", "label" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_arts_classify_guide"("h" "text", "o" "text", "g" "text", "kind" "text", "category" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_arts_classify_guide"("h" "text", "o" "text", "g" "text", "kind" "text", "category" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_arts_classify_guide"("h" "text", "o" "text", "g" "text", "kind" "text", "category" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_arts_commit_file"("h" "text", "o" "text", "g" "text", "fmt" "text", "sha" "text", "previous" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_arts_commit_file"("h" "text", "o" "text", "g" "text", "fmt" "text", "sha" "text", "previous" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_arts_commit_file"("h" "text", "o" "text", "g" "text", "fmt" "text", "sha" "text", "previous" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_arts_cost_overview"("guides" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_arts_cost_overview"("guides" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."compi_arts_cost_overview"("guides" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."compi_arts_file_access"("h" "text", "o" "text", "g" "text", "fmt" "text", "editing" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_arts_file_access"("h" "text", "o" "text", "g" "text", "fmt" "text", "editing" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_arts_file_access"("h" "text", "o" "text", "g" "text", "fmt" "text", "editing" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_arts_generator_outlet"("h" "text", "o" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_arts_generator_outlet"("h" "text", "o" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_arts_generator_outlet"("h" "text", "o" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_arts_guide_source"("h" "text", "o" "text", "g" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_arts_guide_source"("h" "text", "o" "text", "g" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_arts_guide_source"("h" "text", "o" "text", "g" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_arts_image_labels"("h" "text", "o" "text", "g" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_arts_image_labels"("h" "text", "o" "text", "g" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_arts_image_labels"("h" "text", "o" "text", "g" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_arts_recipe_cost"("h" "text", "o" "text", "g" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_arts_recipe_cost"("h" "text", "o" "text", "g" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_arts_recipe_cost"("h" "text", "o" "text", "g" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_arts_reserve_generated_draft"("h" "text", "o" "text", "ticket" "uuid", "label" "text", "fingerprint" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_arts_reserve_generated_draft"("h" "text", "o" "text", "ticket" "uuid", "label" "text", "fingerprint" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_arts_reserve_generated_draft"("h" "text", "o" "text", "ticket" "uuid", "label" "text", "fingerprint" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_arts_review_guide"("h" "text", "o" "text", "g" "text", "reviewed" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_arts_review_guide"("h" "text", "o" "text", "g" "text", "reviewed" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_arts_review_guide"("h" "text", "o" "text", "g" "text", "reviewed" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_arts_save_guide_source"("h" "text", "o" "text", "g" "text", "source" "jsonb", "docx" "text", "pdf" "text", "previous" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_arts_save_guide_source"("h" "text", "o" "text", "g" "text", "source" "jsonb", "docx" "text", "pdf" "text", "previous" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_arts_save_guide_source"("h" "text", "o" "text", "g" "text", "source" "jsonb", "docx" "text", "pdf" "text", "previous" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_arts_save_recipe_cost"("h" "text", "o" "text", "g" "text", "settings" "jsonb", "previous" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_arts_save_recipe_cost"("h" "text", "o" "text", "g" "text", "settings" "jsonb", "previous" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_arts_save_recipe_cost"("h" "text", "o" "text", "g" "text", "settings" "jsonb", "previous" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_arts_stage_guide_access"("h" "text", "o" "text", "g" "text", "fmt" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_arts_stage_guide_access"("h" "text", "o" "text", "g" "text", "fmt" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_arts_stage_guide_access"("h" "text", "o" "text", "g" "text", "fmt" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_arts_workspace_catalog"("after_h" "text", "after_o" "text", "after_g" "text", "batch" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_arts_workspace_catalog"("after_h" "text", "after_o" "text", "after_g" "text", "batch" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_arts_workspace_catalog"("after_h" "text", "after_o" "text", "after_g" "text", "batch" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_arts_workspace_guide"("h" "text", "o" "text", "g" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_arts_workspace_guide"("h" "text", "o" "text", "g" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_arts_workspace_guide"("h" "text", "o" "text", "g" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_arts_workspace_media"("h" "text", "o" "text", "g" "text", "variant" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_arts_workspace_media"("h" "text", "o" "text", "g" "text", "variant" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_arts_workspace_media"("h" "text", "o" "text", "g" "text", "variant" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_assistant_settings"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_assistant_settings"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_begin_accept"("ticket" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_begin_accept"("ticket" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_begin_recovery"("address" "text", "code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_begin_recovery"("address" "text", "code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_catalog_change"("h" "text", "o" "text", "g" "text", "op" "text", "label" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_catalog_change"("h" "text", "o" "text", "g" "text", "op" "text", "label" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_catalog_change"("h" "text", "o" "text", "g" "text", "op" "text", "label" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_classify_guide"("h" "text", "o" "text", "g" "text", "kind" "text", "category" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_classify_guide"("h" "text", "o" "text", "g" "text", "kind" "text", "category" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_classify_guide"("h" "text", "o" "text", "g" "text", "kind" "text", "category" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_commit_document_brand"("h" "text", "accent" "text", "logo_png" "text", "expected_revision" integer, "verified_sub" "uuid", "verified_session" "uuid", "verified_aal" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_commit_document_brand"("h" "text", "accent" "text", "logo_png" "text", "expected_revision" integer, "verified_sub" "uuid", "verified_session" "uuid", "verified_aal" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_commit_file"("h" "text", "o" "text", "g" "text", "fmt" "text", "sha" "text", "previous" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_commit_file"("h" "text", "o" "text", "g" "text", "fmt" "text", "sha" "text", "previous" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_commit_file"("h" "text", "o" "text", "g" "text", "fmt" "text", "sha" "text", "previous" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_delete_withdrawn_employee"("h" "text", "employee" "uuid", "withdrawal" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_delete_withdrawn_employee"("h" "text", "employee" "uuid", "withdrawal" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_delete_withdrawn_employee"("h" "text", "employee" "uuid", "withdrawal" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_document_brand"("h" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_document_brand"("h" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_document_brand"("h" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_document_brand_revision"("h" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_document_brand_revision"("h" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_document_brand_revision"("h" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_file_access"("h" "text", "o" "text", "g" "text", "fmt" "text", "editing" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_file_access"("h" "text", "o" "text", "g" "text", "fmt" "text", "editing" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_file_access"("h" "text", "o" "text", "g" "text", "fmt" "text", "editing" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_finish_password_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_finish_password_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_finish_password_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_generator_outlet"("h" "text", "o" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_generator_outlet"("h" "text", "o" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_generator_outlet"("h" "text", "o" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_guide_source"("h" "text", "o" "text", "g" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_guide_source"("h" "text", "o" "text", "g" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_guide_source"("h" "text", "o" "text", "g" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_lab_invitee"("h" "text", "employee" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_lab_invitee"("h" "text", "employee" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_lab_invitee"("h" "text", "employee" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_lab_mail_finish"("p_employee" "uuid", "p_attempt" "uuid", "p_message" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_lab_mail_finish"("p_employee" "uuid", "p_attempt" "uuid", "p_message" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_lab_mail_reserve"("p_employee" "uuid", "p_recipient" "text", "p_attempt" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_lab_mail_reserve"("p_employee" "uuid", "p_recipient" "text", "p_attempt" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_lab_relay"("addr" "text", "proof" "text", "receipt" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_lab_relay"("addr" "text", "proof" "text", "receipt" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_link_created_account"("employee" "uuid", "uid" "uuid", "creator" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_link_created_account"("employee" "uuid", "uid" "uuid", "creator" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_mail_change"("h" "text", "op" "text", "data" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_mail_change"("h" "text", "op" "text", "data" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_mail_change"("h" "text", "op" "text", "data" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_mail_read"("h" "text", "box" "text", "p" integer, "item" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_mail_read"("h" "text", "box" "text", "p" integer, "item" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_mail_read"("h" "text", "box" "text", "p" integer, "item" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_manage_invitation"("h" "text", "employee" "uuid", "op" "text", "previous" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_manage_invitation"("h" "text", "employee" "uuid", "op" "text", "previous" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_manage_invitation"("h" "text", "employee" "uuid", "op" "text", "previous" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_my_access"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_my_access"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_my_access"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_needs_mfa"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_needs_mfa"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_needs_mfa"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_personal_backup"("issue" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_personal_backup"("issue" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_personal_backup"("issue" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_provision_lab_channel"("h" "text", "employee_id" "uuid", "recipient_address" "text", "proof_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_provision_lab_channel"("h" "text", "employee_id" "uuid", "recipient_address" "text", "proof_hash" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_recipe_cost"("h" "text", "o" "text", "g" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_recipe_cost"("h" "text", "o" "text", "g" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_recipe_cost"("h" "text", "o" "text", "g" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_register_employee"("h" "text", "request_id" "uuid", "given_name" "text", "surname" "text", "position_name" "text", "outlet_name" "text", "access_rank" smallint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_register_employee"("h" "text", "request_id" "uuid", "given_name" "text", "surname" "text", "position_name" "text", "outlet_name" "text", "access_rank" smallint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_register_employee"("h" "text", "request_id" "uuid", "given_name" "text", "surname" "text", "position_name" "text", "outlet_name" "text", "access_rank" smallint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_release_recovery"("uid" "uuid", "lease" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_release_recovery"("uid" "uuid", "lease" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_remove_pending_employee"("h" "text", "employee" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_remove_pending_employee"("h" "text", "employee" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_remove_pending_employee"("h" "text", "employee" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_reserve_executive"("h" "text", "given_name" "text", "surname" "text", "position_name" "text", "outlet_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_reserve_executive"("h" "text", "given_name" "text", "surname" "text", "position_name" "text", "outlet_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_reserve_generated_draft"("h" "text", "o" "text", "ticket" "uuid", "label" "text", "fingerprint" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_reserve_generated_draft"("h" "text", "o" "text", "ticket" "uuid", "label" "text", "fingerprint" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_reserve_generated_draft"("h" "text", "o" "text", "ticket" "uuid", "label" "text", "fingerprint" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_review_guide"("h" "text", "o" "text", "g" "text", "reviewed" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_review_guide"("h" "text", "o" "text", "g" "text", "reviewed" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_review_guide"("h" "text", "o" "text", "g" "text", "reviewed" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_save_guide_source"("h" "text", "o" "text", "g" "text", "source" "jsonb", "docx" "text", "pdf" "text", "previous" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_save_guide_source"("h" "text", "o" "text", "g" "text", "source" "jsonb", "docx" "text", "pdf" "text", "previous" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_save_guide_source"("h" "text", "o" "text", "g" "text", "source" "jsonb", "docx" "text", "pdf" "text", "previous" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_save_recipe_cost"("h" "text", "o" "text", "g" "text", "settings" "jsonb", "previous" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_save_recipe_cost"("h" "text", "o" "text", "g" "text", "settings" "jsonb", "previous" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_save_recipe_cost"("h" "text", "o" "text", "g" "text", "settings" "jsonb", "previous" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_schedule_balance"("h" "text", "employee_id" "uuid", "month_start" "date", "adjustment" integer, "previous" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_schedule_balance"("h" "text", "employee_id" "uuid", "month_start" "date", "adjustment" integer, "previous" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_schedule_balance"("h" "text", "employee_id" "uuid", "month_start" "date", "adjustment" integer, "previous" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_schedule_decide"("h" "text", "request_id" "uuid", "decision" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_schedule_decide"("h" "text", "request_id" "uuid", "decision" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_schedule_decide"("h" "text", "request_id" "uuid", "decision" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_schedule_edit"("h" "text", "employee_id" "uuid", "work_day" "date", "kind" "text", "start_time" time without time zone, "end_time" time without time zone, "previous" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_schedule_edit"("h" "text", "employee_id" "uuid", "work_day" "date", "kind" "text", "start_time" time without time zone, "end_time" time without time zone, "previous" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_schedule_edit"("h" "text", "employee_id" "uuid", "work_day" "date", "kind" "text", "start_time" time without time zone, "end_time" time without time zone, "previous" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_schedule_request"("h" "text", "request_id" "uuid", "requested" "date"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_schedule_request"("h" "text", "request_id" "uuid", "requested" "date"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_schedule_request"("h" "text", "request_id" "uuid", "requested" "date"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_schedule_view"("h" "text", "month_start" "date", "department" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_schedule_view"("h" "text", "month_start" "date", "department" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_schedule_view"("h" "text", "month_start" "date", "department" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_set_staff_access"("h" "text", "employee" "uuid", "enabled" boolean, "expected_rank" smallint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_set_staff_access"("h" "text", "employee" "uuid", "enabled" boolean, "expected_rank" smallint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_set_staff_access"("h" "text", "employee" "uuid", "enabled" boolean, "expected_rank" smallint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_staff_change"("h" "text", "op" "text", "item" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_staff_change"("h" "text", "op" "text", "item" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_staff_change"("h" "text", "op" "text", "item" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_stage_guide_access"("h" "text", "o" "text", "g" "text", "fmt" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_stage_guide_access"("h" "text", "o" "text", "g" "text", "fmt" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_stage_guide_access"("h" "text", "o" "text", "g" "text", "fmt" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_workspace_catalog"("after_h" "text", "after_o" "text", "after_g" "text", "batch" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_workspace_catalog"("after_h" "text", "after_o" "text", "after_g" "text", "batch" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_workspace_catalog"("after_h" "text", "after_o" "text", "after_g" "text", "batch" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_workspace_guide"("h" "text", "o" "text", "g" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_workspace_guide"("h" "text", "o" "text", "g" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_workspace_guide"("h" "text", "o" "text", "g" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compi_workspace_media"("h" "text", "o" "text", "g" "text", "variant" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compi_workspace_media"("h" "text", "o" "text", "g" "text", "variant" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compi_workspace_media"("h" "text", "o" "text", "g" "text", "variant" "text") TO "service_role";


















GRANT ALL ON TABLE "public"."compi_arts_guides" TO "service_role";
GRANT SELECT ON TABLE "public"."compi_arts_guides" TO "authenticated";



GRANT ALL ON TABLE "public"."compi_arts_outlets" TO "service_role";
GRANT SELECT ON TABLE "public"."compi_arts_outlets" TO "authenticated";



GRANT ALL ON TABLE "public"."compi_guides" TO "service_role";
GRANT SELECT ON TABLE "public"."compi_guides" TO "authenticated";



GRANT ALL ON TABLE "public"."compi_memberships" TO "service_role";
GRANT SELECT ON TABLE "public"."compi_memberships" TO "authenticated";



GRANT ALL ON TABLE "public"."compi_outlets" TO "service_role";
GRANT SELECT ON TABLE "public"."compi_outlets" TO "authenticated";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































