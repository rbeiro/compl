-- MIGRACION MANUAL: direcciones internas de @compi.invalid a @compichef.com.
-- Proyecto: dzfwdxhbldnfqowrnhxf. Una sola transaccion: o se aplica todo o nada.
-- Antes de aplicar: copia de los valores en respaldo_correos_<fecha>/ (fuera de Git).
-- No envia correo real: el buzon sigue siendo interno. No toca contrasenas ni sesiones.
-- Para ensayar sin cambiar nada, sustituir el COMMIT final por ROLLBACK.

BEGIN;

DO $compi_email_domain$
DECLARE
  old_s constant text := '@compi.invalid';
  new_s constant text := '@compichef.com';
  rec record;
  oid_ oid;
  def text;
  owner_ oid; acl_ aclitem[]; sec_ boolean; cfg_ text[];
  n integer;
BEGIN
  -- 1. Funciones: huella revisada, numero exacto de apariciones y mismo propietario/permisos.
  FOR rec IN SELECT * FROM (VALUES
    ('public.compi_manage_invitation(text,uuid,text,uuid)',            'd68eb9157b904595a092e03e22b67e9d', 2),
    ('public.compi_needs_mfa()',                                       '6865fa1bfec390f37dd5b6f8650f0c1a', 1),
    ('compi_private.has_lab_account(uuid)',                            'cbc3216cacd26e1012691c17814dd122', 1),
    ('compi_private.mail_change(text,text,jsonb)',                     '6efa9af791552b5f9113d527762b19fe', 1),
    ('compi_private.register_address(text,uuid,text,text,text,text,smallint)', 'adc05d49eadaf198c053518a23e133a8', 1)
  ) AS v(sig, reviewed_md5, expected) LOOP
    oid_ := to_regprocedure(rec.sig);
    IF oid_ IS NULL THEN RAISE EXCEPTION 'No existe %. No se ha cambiado nada.', rec.sig; END IF;
    SELECT pg_get_functiondef(p.oid), p.proowner, p.proacl, p.prosecdef, p.proconfig
      INTO def, owner_, acl_, sec_, cfg_ FROM pg_proc p WHERE p.oid = oid_;
    IF md5(def) IS DISTINCT FROM rec.reviewed_md5 THEN
      RAISE EXCEPTION 'La funcion % ha cambiado desde la revision.', rec.sig;
    END IF;
    IF (length(def) - length(replace(def, old_s, ''))) / length(old_s) <> rec.expected THEN
      RAISE EXCEPTION 'Apariciones inesperadas en %.', rec.sig;
    END IF;
    EXECUTE replace(def, old_s, new_s);
    IF pg_get_functiondef(oid_) IS DISTINCT FROM replace(def, old_s, new_s) THEN
      RAISE EXCEPTION 'La definicion resultante de % no coincide.', rec.sig;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = oid_ AND (
        p.proowner IS DISTINCT FROM owner_ OR p.proacl IS DISTINCT FROM acl_ OR
        p.prosecdef IS DISTINCT FROM sec_ OR p.proconfig IS DISTINCT FROM cfg_)) THEN
      RAISE EXCEPTION 'Han cambiado propietario, permisos o seguridad de %.', rec.sig;
    END IF;
  END LOOP;

  -- 2. Datos: numero de filas esperado en cada tabla (contado antes de preparar esta migracion).
  UPDATE auth.users SET email = replace(email, old_s, new_s) WHERE email LIKE '%' || old_s;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 25 THEN RAISE EXCEPTION 'auth.users: % filas, se esperaban 25.', n; END IF;

  -- auth.identities.email es columna generada desde identity_data: solo se cambia identity_data.
  UPDATE auth.identities SET identity_data = replace(identity_data::text, old_s, new_s)::jsonb
    WHERE identity_data::text LIKE '%' || old_s || '%';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 25 THEN RAISE EXCEPTION 'auth.identities: % filas, se esperaban 25.', n; END IF;

  UPDATE public.compi_staff SET email = replace(email, old_s, new_s) WHERE email LIKE '%' || old_s;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 25 THEN RAISE EXCEPTION 'compi_staff: % filas, se esperaban 25.', n; END IF;

  UPDATE compi_private.address_allocations SET address = replace(address, old_s, new_s)
    WHERE address LIKE '%' || old_s || '%';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 25 THEN RAISE EXCEPTION 'address_allocations: % filas, se esperaban 25.', n; END IF;

  UPDATE compi_private.mail_items
     SET sender = replace(sender, old_s, new_s), recipients = replace(recipients, old_s, new_s)
   WHERE sender LIKE '%' || old_s || '%' OR recipients LIKE '%' || old_s || '%';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 4 THEN RAISE EXCEPTION 'mail_items: % filas, se esperaban 4.', n; END IF;

  -- 3. No debe quedar ninguna aparicion del dominio antiguo en los sitios revisados.
  IF EXISTS (SELECT 1 FROM auth.users WHERE email LIKE '%compi.invalid%')
     OR EXISTS (SELECT 1 FROM auth.identities WHERE identity_data::text LIKE '%compi.invalid%' OR email LIKE '%compi.invalid%')
     OR EXISTS (SELECT 1 FROM public.compi_staff WHERE email LIKE '%compi.invalid%')
     OR EXISTS (SELECT 1 FROM compi_private.address_allocations WHERE address LIKE '%compi.invalid%')
     OR EXISTS (SELECT 1 FROM compi_private.mail_items WHERE sender LIKE '%compi.invalid%' OR recipients LIKE '%compi.invalid%') THEN
    RAISE EXCEPTION 'Quedan apariciones de compi.invalid.';
  END IF;
END
$compi_email_domain$;

COMMIT;
