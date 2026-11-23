-- REGISTRO CANONICO DE RECETAS (Plating Guides). NO APLICADO EN NINGUN PROYECTO.
-- Una receta estructurada por plato (hotel, outlet, clave de plato), con control de revision como los escandallos.
-- Se prueba primero en local (deployment/local-recetas), despues en compi-pruebas y solo al final en produccion.
-- Una sola transaccion. Para ensayar sin guardar, sustituir COMMIT por ROLLBACK.

BEGIN;

CREATE TABLE compi_private.arts_recipes (
  hotel_key text NOT NULL,
  outlet_key text NOT NULL,
  guide_key text NOT NULL CHECK (guide_key ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  revision uuid NOT NULL,
  status text NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador','revisada','aprobada')),
  record jsonb NOT NULL,
  created_by uuid,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hotel_key, outlet_key, guide_key)
);
ALTER TABLE compi_private.arts_recipes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON compi_private.arts_recipes FROM public, anon, authenticated;

-- Validacion estructural del registro (recipe.schema.json v1.0). La validacion completa del esquema se repite en la funcion de servidor.
CREATE FUNCTION compi_private.arts_recipe_check(r jsonb, o text, g text, st text) RETURNS void
 LANGUAGE plpgsql IMMUTABLE SET search_path TO ''
AS $$
declare
  top constant text[] := array['schema_version','dish_id','outlet_id','document_type','name_es','name_en','section','ingredients','steps','service_info','portion','pass_minutes','station','dishware','channel_zone','exterior_service','allergens','traces','adaptations','diet','non_allergen_restrictions','metadata','source_refs','provenance','unresolved'];
  ing_keys constant text[] := array['id','name_es','quantity','unit','original_measure','optional','preparation','image_label','source_refs','evidence_status'];
  units constant text[] := array['g','kg','ml','l','unidad','porcion','cucharada','cucharadita','al_gusto','desconocida'];
  evid constant text[] := array['declarado','verificado','estimado','pendiente'];
  ids text[]; item jsonb; i int; approved boolean;
begin
  if jsonb_typeof(r)<>'object' or octet_length(r::text)>96000 or not (r ?& top) or r - top <> '{}'::jsonb then raise invalid_parameter_value using message='Registro de receta no valido: claves.'; end if;
  if r->>'schema_version' is distinct from '1.0' or r->>'document_type' is distinct from 'plating_guide'
     or r->>'dish_id' is distinct from g or r->>'outlet_id' is distinct from o then raise invalid_parameter_value using message='Registro de receta no valido: identidad.'; end if;
  if jsonb_typeof(r->'name_es')<>'string' or length(btrim(r->>'name_es')) not between 1 and 200
     or jsonb_typeof(r->'name_en') not in ('string','null') or jsonb_typeof(r->'section')<>'string' then raise invalid_parameter_value using message='Registro de receta no valido: nombre.'; end if;
  if jsonb_typeof(r->'ingredients')<>'array' or jsonb_array_length(r->'ingredients') not between 1 and 60 then raise invalid_parameter_value using message='Registro de receta no valido: ingredientes.'; end if;
  ids := '{}';
  for item in select value from jsonb_array_elements(r->'ingredients') loop
    if jsonb_typeof(item)<>'object' or not (item ?& ing_keys) or item - ing_keys <> '{}'::jsonb
       or jsonb_typeof(item->'id')<>'string' or item->>'id' !~ '^[a-z0-9_-]{1,20}$' or item->>'id' = any(ids)
       or jsonb_typeof(item->'name_es')<>'string' or length(btrim(item->>'name_es')) not between 1 and 120
       or jsonb_typeof(item->'quantity') not in ('number','null') or (jsonb_typeof(item->'quantity')='number' and (item->>'quantity')::numeric < 0)
       or jsonb_typeof(item->'unit')<>'string' or not (item->>'unit' = any(units))
       or (item->>'unit'='desconocida' and jsonb_typeof(item->'quantity')<>'null')
       or jsonb_typeof(item->'optional')<>'boolean'
       or jsonb_typeof(item->'evidence_status')<>'string' or not (item->>'evidence_status' = any(evid))
       or jsonb_typeof(item->'source_refs')<>'array'
    then raise invalid_parameter_value using message='Registro de receta no valido: ingrediente.'; end if;
    ids := ids || (item->>'id');
  end loop;
  if jsonb_typeof(r->'steps')<>'array' or jsonb_array_length(r->'steps') not between 1 and 30 then raise invalid_parameter_value using message='Registro de receta no valido: pasos.'; end if;
  i := 0;
  for item in select value from jsonb_array_elements(r->'steps') loop
    i := i + 1;
    if jsonb_typeof(item)<>'object' or not (item ?& array['number','action','observation','source_refs']) or item - array['number','action','observation','source_refs'] <> '{}'::jsonb
       or jsonb_typeof(item->'number')<>'number' or (item->>'number')::numeric <> i
       or jsonb_typeof(item->'action')<>'string' or length(btrim(item->>'action'))=0 then raise invalid_parameter_value using message='Registro de receta no valido: paso.'; end if;
  end loop;
  if jsonb_typeof(r->'portion')<>'object' or r->'portion'->>'basis' is null or not (r->'portion'->>'basis' = any(array['declarada','medida','calculada','estimada','desconocida']))
     or (r->'portion'->>'basis'='desconocida' and jsonb_typeof(r->'portion'->'grams')<>'null') then raise invalid_parameter_value using message='Registro de receta no valido: racion.'; end if;
  if jsonb_typeof(r->'allergens')<>'array' or jsonb_typeof(r->'adaptations')<>'array' then raise invalid_parameter_value using message='Registro de receta no valido: alergenos.'; end if;
  for item in select value from jsonb_array_elements(r->'allergens') loop
    if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'ingredient_ids')<>'array' or not (item->>'verification' = any(array['declarado','comprobado','pendiente']))
       or exists(select 1 from jsonb_array_elements_text(item->'ingredient_ids') x where x <> all(ids)) then raise invalid_parameter_value using message='Registro de receta no valido: alergeno.'; end if;
  end loop;
  for item in select value from jsonb_array_elements(r->'adaptations') loop
    if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'removed_ingredient_ids')<>'array'
       or exists(select 1 from jsonb_array_elements_text(item->'removed_ingredient_ids') x where x <> all(ids)) then raise invalid_parameter_value using message='Registro de receta no valido: adaptacion.'; end if;
  end loop;
  if jsonb_typeof(r->'traces')<>'object' or not (r->'traces'->>'status' = any(array['desconocido','declarado_sin_trazas','declarado_con_trazas','verificado_sin_trazas','verificado_con_trazas']))
     or jsonb_typeof(r->'diet')<>'object' or not (r->'diet'->>'label' = any(array['vegetariano','vegano','ninguna_declaracion','pendiente']))
     or not (r->'diet'->>'verification' = any(array['declarado','comprobado','pendiente']))
     or jsonb_typeof(r->'metadata')<>'object' or jsonb_typeof(r->'service_info')<>'object' then raise invalid_parameter_value using message='Registro de receta no valido: trazas, dieta o metadatos.'; end if;
  if jsonb_typeof(r->'non_allergen_restrictions')<>'array' or jsonb_typeof(r->'source_refs')<>'array' or jsonb_typeof(r->'provenance')<>'array' or jsonb_typeof(r->'unresolved')<>'array'
     then raise invalid_parameter_value using message='Registro de receta no valido: listas.'; end if;
  -- Nada se marca como aprobado sin estado y evidencia de aprobacion.
  approved := upper(coalesce(r->'metadata'->>'document_status','')) = 'APROBADO';
  if approved is distinct from (st='aprobada') or (st='aprobada' and length(coalesce(r->'metadata'->>'approval_evidence_id',''))=0)
     then raise invalid_parameter_value using message='Registro de receta no valido: aprobacion.'; end if;
end $$;
REVOKE ALL ON FUNCTION compi_private.arts_recipe_check(jsonb, text, text, text) FROM public, anon, authenticated;

CREATE FUNCTION compi_private.arts_get_recipe(h text, o text, g text) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
declare item compi_private.arts_recipes%rowtype;
begin
  if not compi_private.active_download_session() or compi_private.my_rank(h) is null or compi_private.my_rank(h) not between 1 and 3 then raise insufficient_privilege; end if;
  select * into item from compi_private.arts_recipes x where (x.hotel_key,x.outlet_key,x.guide_key)=(h,o,g);
  if not found then return null; end if;
  return jsonb_build_object('revision',item.revision,'status',item.status,'record',item.record,'updated_at',item.updated_at);
end $$;

CREATE FUNCTION compi_private.arts_list_recipes(h text, o text) RETURNS TABLE(guide_key text, name_es text, status text, revision uuid, updated_at timestamptz)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
begin
  if not compi_private.active_download_session() or compi_private.my_rank(h) is null or compi_private.my_rank(h) not between 1 and 3 then raise insufficient_privilege; end if;
  return query select x.guide_key, x.record->>'name_es', x.status, x.revision, x.updated_at
    from compi_private.arts_recipes x where x.hotel_key=h and x.outlet_key=o order by x.guide_key;
end $$;

CREATE FUNCTION compi_private.arts_save_recipe(h text, o text, g text, rec jsonb, st text, previous uuid) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
declare old compi_private.arts_recipes%rowtype; next_id uuid := gen_random_uuid(); rk int;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(h,731));
  rk := compi_private.my_rank(h);
  if not compi_private.active_download_session() or rk is null or rk not between 1 and 2 then raise insufficient_privilege; end if;
  if st='aprobada' and rk<>1 then raise insufficient_privilege; end if;
  if not exists(select 1 from public.compi_arts_outlets x where (x.hotel_key,x.outlet_key)=(h,o) and not x.archived) then
    raise exception using errcode='PT404',message='Outlet no disponible en este hotel.'; end if;
  if st is null or st not in ('borrador','revisada','aprobada') then raise invalid_parameter_value; end if;
  perform compi_private.arts_recipe_check(rec,o,g,st);
  select * into old from compi_private.arts_recipes x where (x.hotel_key,x.outlet_key,x.guide_key)=(h,o,g);
  if found and old.record=rec and old.status=st then return old.revision; end if;
  if old.revision is distinct from previous then raise exception using errcode='PT409',message='La receta ha cambiado. Vuelve a abrirla.'; end if;
  insert into compi_private.arts_recipes(hotel_key,outlet_key,guide_key,revision,status,record,created_by,updated_by)
    values(h,o,g,next_id,st,rec,auth.uid(),auth.uid())
    on conflict (hotel_key,outlet_key,guide_key) do update set revision=excluded.revision,status=excluded.status,record=excluded.record,updated_by=excluded.updated_by,updated_at=now();
  return next_id;
end $$;

REVOKE ALL ON FUNCTION compi_private.arts_get_recipe(text,text,text), compi_private.arts_list_recipes(text,text), compi_private.arts_save_recipe(text,text,text,jsonb,text,uuid) FROM public, anon, authenticated, service_role;
-- Las funciones publicas son envoltorios que se ejecutan con los permisos de quien llama.
GRANT EXECUTE ON FUNCTION compi_private.arts_get_recipe(text,text,text), compi_private.arts_list_recipes(text,text), compi_private.arts_save_recipe(text,text,text,jsonb,text,uuid) TO authenticated;

CREATE FUNCTION public.compi_arts_get_recipe(h text, o text, g text) RETURNS jsonb
 LANGUAGE sql STABLE SET search_path TO '' AS $$ select compi_private.arts_get_recipe(h,o,g) $$;
CREATE FUNCTION public.compi_arts_list_recipes(h text, o text) RETURNS TABLE(guide_key text, name_es text, status text, revision uuid, updated_at timestamptz)
 LANGUAGE sql STABLE SET search_path TO '' AS $$ select * from compi_private.arts_list_recipes(h,o) $$;
CREATE FUNCTION public.compi_arts_save_recipe(h text, o text, g text, rec jsonb, st text, previous uuid) RETURNS uuid
 LANGUAGE sql SET search_path TO '' AS $$ select compi_private.arts_save_recipe(h,o,g,rec,st,previous) $$;
REVOKE ALL ON FUNCTION public.compi_arts_get_recipe(text,text,text), public.compi_arts_list_recipes(text,text), public.compi_arts_save_recipe(text,text,text,jsonb,text,uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.compi_arts_get_recipe(text,text,text), public.compi_arts_list_recipes(text,text), public.compi_arts_save_recipe(text,text,text,jsonb,text,uuid) TO authenticated;

COMMIT;
