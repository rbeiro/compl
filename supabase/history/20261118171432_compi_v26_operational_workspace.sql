-- Workspace metadata extends existing guides without changing their document, source or storage policies.

create table compi_private.guide_classifications (
  hotel_key text not null, outlet_key text not null, guide_key text not null,
  kind text check (kind in ('plato','elaboracion')),
  category text check (category in ('entrantes','principales','postres','fondos','salsas','bases','guarniciones','otros')),
  primary key (hotel_key,outlet_key,guide_key),
  foreign key (hotel_key,outlet_key,guide_key) references public.compi_guides on delete cascade
);
create table compi_private.guide_costs (
  hotel_key text not null, outlet_key text not null, guide_key text not null,
  revision uuid not null, settings jsonb not null,
  primary key (hotel_key,outlet_key,guide_key),
  foreign key (hotel_key,outlet_key,guide_key) references public.compi_guides on delete cascade
);
create table compi_private.guide_reviews (
  user_id uuid not null references auth.users(id) on delete cascade,
  hotel_key text not null, outlet_key text not null, guide_key text not null,
  primary key (user_id,hotel_key,outlet_key,guide_key),
  foreign key (hotel_key,outlet_key,guide_key) references public.compi_guides on delete cascade
);
alter table compi_private.guide_classifications enable row level security;
alter table compi_private.guide_costs enable row level security;
alter table compi_private.guide_reviews enable row level security;
revoke all on compi_private.guide_classifications,compi_private.guide_costs,compi_private.guide_reviews from public,anon,authenticated;

-- A structured source describes the current documents only if both committed digests still match.
create view compi_private.workspace_sources as
select s.hotel_key,s.outlet_key,s.guide_key,s.revision,s.source->'data' as data,
  case when s.source->'imagen_aprobada'->>'tipo' in ('foto','acuarela') then s.source->'imagen_aprobada'->>'tipo' end as image_kind,
  s.source->'imagen_aprobada'->>'sha256' as approved_sha,
  case when s.source->'imagen_aprobada'->>'tipo'='acuarela' then s.source->'assets'->'art'->>'sha256' end as clean_sha
from compi_private.guide_sources s
join compi_private.validated_files w on (w.hotel_key,w.outlet_key,w.guide_key,w.format,w.digest)=(s.hotel_key,s.outlet_key,s.guide_key,'docx',s.docx_sha)
join compi_private.validated_files p on (p.hotel_key,p.outlet_key,p.guide_key,p.format,p.digest)=(s.hotel_key,s.outlet_key,s.guide_key,'pdf',s.pdf_sha);
revoke all on compi_private.workspace_sources from public,anon,authenticated;

-- All access to source data uses the same actual file permission as the download or draft editor.
create function compi_private.workspace_access(h text,o text,g text,writing boolean default false) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare is_draft boolean;
begin
  if auth.uid() is null or not compi_private.active_download_session() then raise insufficient_privilege; end if;
  select r.guide_state='draft' into is_draft from public.compi_guides r where (r.hotel_key,r.outlet_key,r.guide_key)=(h,o,g);
  if not found then raise insufficient_privilege; end if;
  perform compi_private.file_access(h,o,g,'pdf',writing or is_draft);
  return is_draft;
end $$;
revoke all on function compi_private.workspace_access(text,text,text,boolean) from public,anon,authenticated;

create function public.compi_workspace_catalog(after_h text default '',after_o text default '',after_g text default '',batch integer default 200)
returns table(hotel_key text,outlet_key text,guide_key text,hotel text,outlet text,title text,guide_state text,kind text,category text,
  reviewed boolean,can_classify boolean,has_source boolean,has_image boolean,image_kind text,has_clean boolean,
  partida text,racion text,pase text,sala_es text)
language sql stable security definer set search_path='' as $$
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

-- Retain only the printable recipe fields. Strip unrecognized fields from every ingredient and step.
create function compi_private.workspace_data(d jsonb) returns jsonb language sql immutable set search_path='' as $$
  select coalesce((select pg_catalog.jsonb_object_agg(k, d->k)
      from unnest(array['nombre_es','nombre_en','sala_es','sala_en','codigo','version','fecha','partida','racion','pase','vajilla',
        'canal_zona','servicio_exterior','contiene','trazas','adaptaciones']) k
      where jsonb_typeof(d->k)='string'),'{}'::jsonb)
    || jsonb_build_object('ingredientes',coalesce((
      select jsonb_agg(jsonb_build_object('nombre',left(i->>'nombre',120),'cantidad',left(i->>'cantidad',40),'unidad',left(i->>'unidad',40)) order by n)
      from jsonb_array_elements(case when jsonb_typeof(d->'ingredientes')='array' then d->'ingredientes' else '[]'::jsonb end)
        with ordinality as rows(i,n) where n<=40 and jsonb_typeof(i->'nombre')='string'
    ),'[]'::jsonb),'pasos',coalesce((
      select jsonb_agg(jsonb_build_object('accion',left(i->>'accion',600),'control',left(i->>'control',600)) order by n)
      from jsonb_array_elements(case when jsonb_typeof(d->'pasos')='array' then d->'pasos' else '[]'::jsonb end)
        with ordinality as rows(i,n) where n<=24 and (jsonb_typeof(i->'accion')='string' or jsonb_typeof(i->'control')='string')
    ),'[]'::jsonb));
$$;
revoke all on function compi_private.workspace_data(jsonb) from public,anon,authenticated;

create function public.compi_workspace_guide(h text,o text,g text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform compi_private.workspace_access(h,o,g);
  return (select jsonb_build_object('data',compi_private.workspace_data(s.data),'has_image',s.approved_sha is not null,
    'image_kind',s.image_kind,'has_clean',s.clean_sha is not null)
    from compi_private.workspace_sources s where (s.hotel_key,s.outlet_key,s.guide_key)=(h,o,g));
end $$;
create function public.compi_workspace_media(h text,o text,g text,variant text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare is_draft boolean; item compi_private.workspace_sources%rowtype; slot text; digest text;
begin
  is_draft:=compi_private.workspace_access(h,o,g);
  if variant is null or variant not in ('approved','clean') then raise invalid_parameter_value; end if;
  select * into item from compi_private.workspace_sources s where (s.hotel_key,s.outlet_key,s.guide_key)=(h,o,g);
  if variant='clean' then slot:='art'; digest:=item.clean_sha;
  else slot:=case item.image_kind when 'foto' then 'photo' when 'acuarela' then 'image' end; digest:=item.approved_sha; end if;
  if slot is null or digest is null or digest !~ '^[0-9a-f]{64}$' then return null; end if;
  return jsonb_build_object('slot',slot,'sha256',digest,'revision',item.revision,'draft',is_draft);
end $$;
create function public.compi_classify_guide(h text,o text,g text,kind text,category text) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(h,731));
  perform compi_private.workspace_access(h,o,g,true);
  if kind is not null and kind not in ('plato','elaboracion') or category is not null and category not in
    ('entrantes','principales','postres','fondos','salsas','bases','guarniciones','otros') then raise invalid_parameter_value; end if;
  insert into compi_private.guide_classifications values(h,o,g,kind,category)
    on conflict(hotel_key,outlet_key,guide_key) do update set kind=excluded.kind,category=excluded.category;
end $$;
create function public.compi_review_guide(h text,o text,g text,reviewed boolean) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(h,731));
  perform compi_private.workspace_access(h,o,g);
  if reviewed is null then raise invalid_parameter_value; end if;
  if reviewed then insert into compi_private.guide_reviews values(auth.uid(),h,o,g) on conflict do nothing;
  else delete from compi_private.guide_reviews v where (v.user_id,v.hotel_key,v.outlet_key,v.guide_key)=(auth.uid(),h,o,g); end if;
  return reviewed;
end $$;
create function public.compi_recipe_cost(h text,o text,g text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare item compi_private.guide_costs%rowtype; ingredients jsonb;
begin
  if compi_private.my_rank(h) is distinct from 1 then raise insufficient_privilege; end if;
  perform compi_private.workspace_access(h,o,g);
  select * into item from compi_private.guide_costs c where (c.hotel_key,c.outlet_key,c.guide_key)=(h,o,g);
  select compi_private.workspace_data(s.data)->'ingredientes' into ingredients from compi_private.workspace_sources s
    where (s.hotel_key,s.outlet_key,s.guide_key)=(h,o,g);
  return jsonb_build_object('revision',item.revision,'settings',item.settings,'ingredientes',coalesce(ingredients,'[]'::jsonb));
end $$;

create function compi_private.cost_number(v jsonb,maximum numeric,places integer,nullable boolean) returns boolean
language sql immutable set search_path='' as $$
  select case when v is null then false when jsonb_typeof(v)='null' then nullable
    when jsonb_typeof(v)<>'number' then false
    else (v::text)::numeric between 0 and maximum and (v::text)::numeric=round((v::text)::numeric,places) end
$$;
revoke all on function compi_private.cost_number(jsonb,numeric,integer,boolean) from public,anon,authenticated;
create function public.compi_save_recipe_cost(h text,o text,g text,settings jsonb,previous uuid) returns uuid
language plpgsql security definer set search_path='' as $$
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

revoke all on function public.compi_workspace_catalog(text,text,text,integer),public.compi_workspace_guide(text,text,text),
  public.compi_workspace_media(text,text,text,text),public.compi_classify_guide(text,text,text,text,text),
  public.compi_review_guide(text,text,text,boolean),public.compi_recipe_cost(text,text,text),
  public.compi_save_recipe_cost(text,text,text,jsonb,uuid) from public,anon;
grant execute on function public.compi_workspace_catalog(text,text,text,integer),public.compi_workspace_guide(text,text,text),
  public.compi_workspace_media(text,text,text,text),public.compi_classify_guide(text,text,text,text,text),
  public.compi_review_guide(text,text,text,boolean),public.compi_recipe_cost(text,text,text),
  public.compi_save_recipe_cost(text,text,text,jsonb,uuid) to authenticated;
;
