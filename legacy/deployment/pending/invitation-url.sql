-- PROPUESTA MANUAL PARA EL PASO 8. NO EJECUTADA EN EL PASO 2.
-- Proyecto: dzfwdxhbldnfqowrnhxf. Confirmar el proyecto antes de aplicar.
-- Aplicar solo tras verificar HTTPS, ruta de invitacion y CORS de produccion.
-- No es una migracion aplicada: crear la migracion definitiva con Supabase CLI.
-- Afecta a todas las nuevas invitaciones de esta RPC compartida.
-- No modifica mensajes existentes, usuarios ni la restriccion @compi.invalid.

BEGIN;

DO $compi_invitation_url$
DECLARE
  target_oid oid := to_regprocedure('public.compi_manage_invitation(text,uuid,text,uuid)');
  reviewed_md5 constant text := 'a8fc4540901857e81d8b52164c8f955a';
  old_url constant text := 'https://compi-laboratorio.leonardo-vincere.chatgpt.site/invitacion.html#';
  new_url constant text := 'https://compichef.com/invitacion.html#';
  before_definition text;
  expected_definition text;
  before_owner oid;
  before_acl aclitem[];
  before_security boolean;
  before_config text[];
BEGIN
  IF target_oid IS NULL THEN
    RAISE EXCEPTION 'No existe la firma exacta revisada. No se ha cambiado nada.';
  END IF;

  SELECT pg_get_functiondef(p.oid), p.proowner, p.proacl, p.prosecdef, p.proconfig
    INTO before_definition, before_owner, before_acl, before_security, before_config
    FROM pg_proc p WHERE p.oid = target_oid;

  IF md5(before_definition) IS DISTINCT FROM reviewed_md5 THEN
    RAISE EXCEPTION 'La funcion ha cambiado desde la revision. Revisar antes de aplicar.';
  END IF;
  IF (length(before_definition) - length(replace(before_definition, old_url, '')))
      / length(old_url) <> 1 THEN
    RAISE EXCEPTION 'La URL antigua no aparece exactamente una vez.';
  END IF;

  expected_definition := replace(before_definition, old_url, new_url);
  EXECUTE expected_definition;

  IF pg_get_functiondef(target_oid) IS DISTINCT FROM expected_definition THEN
    RAISE EXCEPTION 'La definicion resultante no coincide con el unico cambio autorizado.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid = target_oid AND (
      p.proowner IS DISTINCT FROM before_owner OR
      p.proacl IS DISTINCT FROM before_acl OR
      p.prosecdef IS DISTINCT FROM before_security OR
      p.proconfig IS DISTINCT FROM before_config
    )
  ) THEN
    RAISE EXCEPTION 'Han cambiado propietario, permisos, seguridad o configuracion.';
  END IF;

  RAISE NOTICE 'URL actualizada. Invitaciones existentes y reglas de laboratorio conservadas.';
END
$compi_invitation_url$;

COMMIT;
