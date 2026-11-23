-- CUENTAS DIRECTAS (sin invitaciones). Ver docs/CUENTAS_DIRECTAS.md.
-- Se aplica PRIMERO al proyecto de pruebas (urtxakicjonkfmewktip). No aplicar a produccion sin revision y confirmacion.
-- Una sola transaccion. Para ensayar, sustituir COMMIT por ROLLBACK.

BEGIN;

-- 1. Codigo corto por hotel para el sufijo del correo (inicial.apellido.<codigo>@compichef.com).
CREATE TABLE compi_private.hotel_codes (
  hotel_key text PRIMARY KEY,
  code text NOT NULL CHECK (code ~ '^[a-z]{2,8}$') UNIQUE
);
ALTER TABLE compi_private.hotel_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE compi_private.hotel_codes FROM anon, authenticated, service_role;
INSERT INTO compi_private.hotel_codes VALUES ('hotel-arts-barcelona', 'arts');

-- 2. Registro de cuentas creadas (auditoria y limite de ritmo). Nunca guarda contrasenas.
CREATE TABLE compi_private.account_creations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_key text NOT NULL,
  created_by uuid NOT NULL,
  employee uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE compi_private.account_creations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE compi_private.account_creations FROM anon, authenticated, service_role;

-- 3. Marca de cambio obligatorio de contrasena (se lee en tiempo real de auth.users).
CREATE FUNCTION compi_private.must_change_password() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$ select coalesce((select u.raw_app_meta_data->>'compi_must_change' = 'true' from auth.users u where u.id = auth.uid()), false) $$;
REVOKE ALL ON FUNCTION compi_private.must_change_password() FROM public, anon, authenticated, service_role;

-- 4. Enlace de la cuenta creada con su fila de personal. Solo el rol de servicio (Edge Function).
CREATE FUNCTION public.compi_link_created_account(employee uuid, uid uuid, creator uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
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
REVOKE ALL ON FUNCTION public.compi_link_created_account(uuid, uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compi_link_created_account(uuid, uuid, uuid) TO service_role;

-- 5. Fin del cambio obligatorio: solo si la contrasena ha cambiado de verdad desde la creacion.
CREATE FUNCTION public.compi_finish_password_change() RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
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
REVOKE ALL ON FUNCTION public.compi_finish_password_change() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.compi_finish_password_change() TO authenticated;

-- 6. Modificar funciones existentes (huella revisada y cambio exacto).
DO $cuentas$
DECLARE
  def text; oid_ oid; owner_ oid; acl_ aclitem[]; sec_ boolean; cfg_ text[]; new_def text;
BEGIN
  -- 6a. active_download_session(): falso mientras haya cambio de contrasena pendiente.
  oid_ := to_regprocedure('compi_private.active_download_session()');
  SELECT pg_get_functiondef(p.oid), p.proowner, p.proacl, p.prosecdef, p.proconfig INTO def, owner_, acl_, sec_, cfg_ FROM pg_proc p WHERE p.oid = oid_;
  IF md5(def) IS DISTINCT FROM 'c763b007829c94afeb03555b2c44649e' THEN RAISE EXCEPTION 'active_download_session ha cambiado.'; END IF;
  new_def := replace(def, 'and not public.compi_needs_mfa()', 'and not public.compi_needs_mfa() and not compi_private.must_change_password()');
  IF new_def = def THEN RAISE EXCEPTION 'active_download_session: sin cambio.'; END IF;
  EXECUTE new_def;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = oid_ AND (p.proowner IS DISTINCT FROM owner_ OR p.proacl IS DISTINCT FROM acl_ OR p.prosecdef IS DISTINCT FROM sec_ OR p.proconfig IS DISTINCT FROM cfg_)) THEN
    RAISE EXCEPTION 'active_download_session: cambiaron propietario o permisos.'; END IF;

  -- 6b. register_address(): sufijo de hotel en el correo y apellido mas corto para no pasar de 64 caracteres.
  oid_ := to_regprocedure('compi_private.register_address(text,uuid,text,text,text,text,smallint)');
  SELECT pg_get_functiondef(p.oid), p.proowner, p.proacl, p.prosecdef, p.proconfig INTO def, owner_, acl_, sec_, cfg_ FROM pg_proc p WHERE p.oid = oid_;
  IF md5(def) IS DISTINCT FROM '27584da0e71995045b27c93f6e363567' THEN RAISE EXCEPTION 'register_address ha cambiado.'; END IF;
  new_def := replace(def, 'letters text; stem text; suffix text; candidate text; step int:=1;', 'letters text; stem text; suffix text; candidate text; step int:=1; hcode text;');
  new_def := replace(new_def, E'  perform pg_advisory_xact_lock(', E'  select c.code into hcode from compi_private.hotel_codes c where c.hotel_key=h;\n  if hcode is null then raise exception using errcode=''22023'',message=''Este hotel no tiene código de correo.''; end if;\n  perform pg_advisory_xact_lock(');
  new_def := replace(new_def, 'family:=left(family,48);', 'family:=left(family,36);');
  new_def := replace(new_def, '||''.''||family||''@compichef.com'';', '||''.''||family||''.''||hcode||''@compichef.com'';');
  IF (length(new_def) - length(def)) <> (length(' hcode text;') + length(E'  select c.code into hcode from compi_private.hotel_codes c where c.hotel_key=h;\n  if hcode is null then raise exception using errcode=''22023'',message=''Este hotel no tiene código de correo.''; end if;\n') + length('||''.''||hcode') + 0) THEN
    RAISE EXCEPTION 'register_address: el cambio no es el esperado.'; END IF;
  EXECUTE new_def;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = oid_ AND (p.proowner IS DISTINCT FROM owner_ OR p.proacl IS DISTINCT FROM acl_ OR p.prosecdef IS DISTINCT FROM sec_ OR p.proconfig IS DISTINCT FROM cfg_)) THEN
    RAISE EXCEPTION 'register_address: cambiaron propietario o permisos.'; END IF;
END
$cuentas$;

COMMIT;
