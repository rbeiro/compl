
create or replace function compi_private.workspace_text(d jsonb,k text,maximum integer) returns text
language sql immutable strict set search_path='' as $$
  select case when jsonb_typeof(d->k)='string' then left(d->>k,maximum) end
$$;
revoke all on function compi_private.workspace_text(jsonb,text,integer) from public,anon,authenticated;

alter function public.compi_workspace_catalog(text,text,text,integer) set schema compi_private;
revoke all on function compi_private.compi_workspace_catalog(text,text,text,integer) from public,anon,authenticated;
create function public.compi_workspace_catalog(after_h text default '',after_o text default '',after_g text default '',batch integer default 200)
returns table(hotel_key text,outlet_key text,guide_key text,hotel text,outlet text,title text,guide_state text,kind text,category text,
  reviewed boolean,can_classify boolean,has_source boolean,has_image boolean,image_kind text,has_clean boolean,
  partida text,racion text,pase text,sala_es text,nombre_en text)
language sql stable security definer set search_path='' as $$
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

-- Retain only the printable recipe fields. Strip unrecognized fields from every ingredient and step.
create or replace function compi_private.workspace_data(d jsonb) returns jsonb language sql immutable set search_path='' as $$
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
revoke all on function compi_private.workspace_data(jsonb) from public,anon,authenticated;

revoke all on function public.compi_workspace_catalog(text,text,text,integer) from public,anon;
grant execute on function public.compi_workspace_catalog(text,text,text,integer) to authenticated;
;
