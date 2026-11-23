-- ALTA DEL EJECUTIVO por el propietario (script scripts/crear-ejecutivo.mjs). Se aplica DESPUES de cuentas-directas.sql.
-- Dos funciones que solo puede ejecutar el rol de servicio: no hay ninguna via publica para crear ejecutivos.
-- Una sola transaccion. Para ensayar, sustituir COMMIT por ROLLBACK.

BEGIN;

-- 1. Reserva la fila de personal del ejecutivo (rango 1) y su correo inicial.apellido.codigo@compichef.com.
CREATE FUNCTION public.compi_reserve_executive(h text, given_name text, surname text, position_name text, outlet_name text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
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
REVOKE ALL ON FUNCTION public.compi_reserve_executive(text, text, text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compi_reserve_executive(text, text, text, text, text) TO service_role;

-- 2. Activa al ejecutivo reservado con su cuenta de acceso ya creada; cambio de contrasena obligatorio.
CREATE FUNCTION public.compi_activate_executive(employee uuid, uid uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
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
REVOKE ALL ON FUNCTION public.compi_activate_executive(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compi_activate_executive(uuid, uuid) TO service_role;

COMMIT;
