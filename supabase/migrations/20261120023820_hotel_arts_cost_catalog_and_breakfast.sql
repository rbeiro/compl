alter table compi_private.arts_guide_classifications drop constraint guide_classifications_category_check,
  add constraint guide_classifications_category_check check (category in ('desayunos','entrantes','principales','postres','fondos','salsas','bases','guarniciones','otros'));

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
    ('desayunos','entrantes','principales','postres','fondos','salsas','bases','guarniciones','otros') then raise invalid_parameter_value; end if;
  insert into compi_private.arts_guide_classifications values(h,o,g,kind,category)
    on conflict(hotel_key,outlet_key,guide_key) do update set kind=excluded.kind,category=excluded.category;
end $function$
;


-- Batch only the cost records that the calling account can read individually.
create or replace function public.compi_arts_cost_overview(guides jsonb)
returns table (hotel_key text, outlet_key text, guide_key text, settings jsonb, ingredient_count integer)
language sql stable security invoker set search_path = '' as $$
  with keys as materialized (
    select distinct k.h,k.o,k.g from pg_catalog.jsonb_to_recordset(guides) as k(h text,o text,g text)
    limit 200
  ), details as materialized (
    select k.*,public.compi_arts_recipe_cost(k.h,k.o,k.g) as entry from keys k
  )
  select h,o,g,entry->'settings',pg_catalog.jsonb_array_length(entry->'ingredientes') from details
$$;
revoke all on function public.compi_arts_cost_overview(jsonb) from public,anon,authenticated;
grant execute on function public.compi_arts_cost_overview(jsonb) to authenticated;
notify pgrst,'reload schema';
;
