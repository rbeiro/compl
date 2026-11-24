-- Reversible, additive storage for recipes prepared with the photographic assistant.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('compi-guide-media','compi-guide-media',false,10485760,array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict(id) do nothing;
drop policy if exists compi_guide_media_proxy on storage.objects;
create policy compi_guide_media_proxy on storage.objects as restrictive for all to anon, authenticated
using(bucket_id <> 'compi-guide-media') with check(bucket_id <> 'compi-guide-media');

create table if not exists compi_private.guide_sources (
 hotel_key text not null, outlet_key text not null, guide_key text not null,
 revision uuid not null, source jsonb not null,
 docx_sha text not null, pdf_sha text not null,
 primary key(hotel_key,outlet_key,guide_key),
 foreign key(hotel_key,outlet_key,guide_key) references public.compi_guides on delete cascade
);
alter table compi_private.guide_sources enable row level security;
revoke all on compi_private.guide_sources from public,anon,authenticated;

create or replace function compi_private.guide_source(h text,o text,g text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
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
create or replace function public.compi_guide_source(h text,o text,g text)
returns jsonb language sql stable security invoker set search_path='' as $$select compi_private.guide_source(h,o,g)$$;

create or replace function public.compi_stage_guide_access(h text,o text,g text,fmt text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.compi_generator_outlet(h,o))
    or not exists(select 1 from public.compi_guides r where (r.hotel_key,r.outlet_key,r.guide_key)=(h,o,g) and r.guide_state='draft')
 then raise insufficient_privilege; end if;
 return compi_private.file_access(h,o,g,fmt,true);
end $$;
revoke all on function public.compi_stage_guide_access(text,text,text,text) from public,anon;
grant execute on function public.compi_stage_guide_access(text,text,text,text) to authenticated;

create or replace function compi_private.save_guide_source(h text,o text,g text,source jsonb,docx text,pdf text,previous uuid)
returns uuid language plpgsql security definer set search_path='' as $$
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
end $$;
create or replace function public.compi_save_guide_source(h text,o text,g text,source jsonb,docx text,pdf text,previous uuid)
returns uuid language sql security invoker set search_path='' as $$select compi_private.save_guide_source(h,o,g,source,docx,pdf,previous)$$;
revoke all on function compi_private.guide_source(text,text,text),public.compi_guide_source(text,text,text),
 compi_private.save_guide_source(text,text,text,jsonb,text,text,uuid),public.compi_save_guide_source(text,text,text,jsonb,text,text,uuid) from public,anon;
grant execute on function compi_private.guide_source(text,text,text),public.compi_guide_source(text,text,text),
 compi_private.save_guide_source(text,text,text,jsonb,text,text,uuid),public.compi_save_guide_source(text,text,text,jsonb,text,text,uuid) to authenticated;;
