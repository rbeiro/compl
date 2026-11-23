-- COMPLEMENTO de email-domain.sql: patrones escritos como compi[.]invalid.
-- La primera migracion solo buscaba el texto compi.invalid y no vio estas formas.
-- Proyecto: dzfwdxhbldnfqowrnhxf. Una sola transaccion. Para ensayar, sustituir COMMIT por ROLLBACK.

BEGIN;

DO $compi_email_domain_regex$
DECLARE
  old_s constant text := 'compi[.]invalid';
  new_s constant text := 'compichef[.]com';
  rec record;
  oid_ oid;
  def text;
  owner_ oid; acl_ aclitem[]; sec_ boolean; cfg_ text[];
BEGIN
  FOR rec IN SELECT * FROM (VALUES
    ('compi_private.lab_invitee(text,uuid)',       '7a24fb86965525e602877d861d044893', 1),
    ('public.compi_manage_invitation(text,uuid,text,uuid)', 'a830cfd59b60a483fdd2154804098ede', 1),
    ('compi_private.mail_owner(text)',             '7753633390d919b4812290d3571a4b52', 1),
    ('compi_private.mail_change(text,text,jsonb)', '90379b254fe19a0c64f5ef9f0a419290', 1),
    ('public.compi_lab_relay(text,text,uuid)',     '833e6aa5f42815b36dc7d533d9cc992b', 1)
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

  -- Restriccion de la bandeja de salida de laboratorio (tabla vacia, comprobado antes).
  IF (SELECT count(*) FROM compi_private.lab_mail_outbox) <> 0 THEN
    RAISE EXCEPTION 'lab_mail_outbox ya no esta vacia. Revisar.';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
        WHERE conrelid = 'compi_private.lab_mail_outbox'::regclass AND conname = 'lab_mail_outbox_recipient_check')
     IS DISTINCT FROM $c$CHECK ((recipient ~ '^[a-z0-9._+-]+@compi[.]invalid$'::text))$c$ THEN
    RAISE EXCEPTION 'La restriccion lab_mail_outbox_recipient_check ha cambiado.';
  END IF;
  ALTER TABLE compi_private.lab_mail_outbox DROP CONSTRAINT lab_mail_outbox_recipient_check;
  ALTER TABLE compi_private.lab_mail_outbox ADD CONSTRAINT lab_mail_outbox_recipient_check
    CHECK (recipient ~ '^[a-z0-9._+-]+@compichef[.]com$');

  -- No debe quedar ninguna forma del dominio antiguo en funciones ni restricciones.
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.prokind = 'f'
        AND p.pronamespace::regnamespace::text IN ('public','compi_private')
        AND p.prosrc ~ 'compi(\[\.\]|\\\.|\.)invalid')
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE pg_get_constraintdef(oid) ~ 'compi(\[\.\]|\\\.|\.)invalid') THEN
    RAISE EXCEPTION 'Quedan apariciones del dominio antiguo.';
  END IF;
END
$compi_email_domain_regex$;

COMMIT;
