-- VUELTA ATRAS de cuentas directas en produccion. Una transaccion. Solo si la migracion se aplico y hay que deshacerla.
-- Comprueba que cada funcion sigue siendo la version nueva (huella de pruebas) antes de restaurar la original.
BEGIN;
DO $revertir$
DECLARE def text; oid_ oid;
BEGIN
  oid_ := to_regprocedure('compi_private.active_download_session()');
  IF md5(pg_get_functiondef(oid_)) IS DISTINCT FROM 'adbf29ccc2cd94d0b7256b0a35400006' THEN RAISE EXCEPTION 'active_download_session no es la version nueva esperada.'; END IF;
  EXECUTE $orig$CREATE OR REPLACE FUNCTION compi_private.active_download_session()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists(select 1 from auth.sessions s where s.id::text=auth.jwt()->>'session_id'
    and s.user_id=auth.uid() and (s.not_after is null or s.not_after>now()))
    and not public.compi_needs_mfa()
$function$$orig$;
  oid_ := to_regprocedure('compi_private.register_address(text,uuid,text,text,text,text,smallint)');
  IF md5(pg_get_functiondef(oid_)) IS DISTINCT FROM 'cee1b02154f8a9bcd1523289f036ba01' THEN RAISE EXCEPTION 'register_address no es la version nueva esperada.'; END IF;
  EXECUTE $orig$CREATE OR REPLACE FUNCTION compi_private.register_address(h text, request_id uuid, given_name text, surname text, position_name text, outlet_name text, access_rank smallint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    candidate:=stem||suffix||'.'||family||'@compichef.com';
    exit when not exists(select 1 from compi_private.address_allocations a where a.address=candidate)
      and not exists(select 1 from public.compi_staff s where s.email=candidate)
      and not exists(select 1 from auth.users u where lower(u.email)=candidate);
    step:=step+1;
  end loop;
  insert into compi_private.address_allocations values(request_id,candidate,h,auth.uid(),submitted);
  insert into public.compi_staff(id,hotel_key,employee_name,email,position_name,outlet_name,access_rank,invite_state)
    values(request_id,h,full_name,candidate,btrim(position_name),btrim(outlet_name),access_rank,'prepared');
  return candidate;
end $function$$orig$;
END
$revertir$;
DROP FUNCTION public.compi_activate_executive(uuid, uuid);
DROP FUNCTION public.compi_reserve_executive(text, text, text, text, text);
DROP FUNCTION public.compi_finish_password_change();
DROP FUNCTION public.compi_link_created_account(uuid, uuid, uuid);
DROP FUNCTION compi_private.must_change_password();
-- account_creations es el registro de cuentas creadas: si ya tiene filas, conservarlas antes de borrar la tabla.
DROP TABLE compi_private.account_creations;
DROP TABLE compi_private.hotel_codes;
COMMIT;
