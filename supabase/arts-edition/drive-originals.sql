begin;
create table compi_private.arts_drive_originals (
  hotel_key text not null, outlet_key text not null, guide_key text not null, format text not null check(format in ('pdf','docx')),
  digest text not null check(digest ~ '^[0-9a-f]{64}$'), drive_id text not null unique,
  primary key(hotel_key,outlet_key,guide_key,format),
  foreign key(hotel_key,outlet_key,guide_key) references public.compi_arts_guides on delete cascade
);
alter table compi_private.arts_drive_originals enable row level security;
revoke all on compi_private.arts_drive_originals from public,anon,authenticated;
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
 return jsonb_build_object('prefix',guide.object_prefix,'digest',sha,'drive_original',exists(select 1 from compi_private.arts_drive_originals a where (a.hotel_key,a.outlet_key,a.guide_key,a.format,a.digest)=(h,o,g,fmt,sha)),'path',guide.object_prefix||
   case when sha is null then '' else 'validated/'||sha||'/' end||'ficha.'||fmt);
end $function$
;
commit;
