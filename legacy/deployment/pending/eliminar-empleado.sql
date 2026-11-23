-- MEJORA DE LA ELIMINACION DE EMPLEADOS.
-- 1) "Eliminar empleado" borra tambien el usuario de acceso si ya no pertenece a ningun hotel (antes quedaba un usuario huerfano).
-- 2) Las filas "Pendiente de activacion" (sin cuenta) se pueden eliminar desde la pantalla: nueva funcion compi_remove_pending_employee.
-- Se aplica PRIMERO al proyecto de pruebas. Una sola transaccion. Para ensayar, sustituir COMMIT por ROLLBACK.

BEGIN;

-- 1. delete_withdrawn_employee: tras borrar la ficha, borra el usuario si no tiene otra ficha ni pertenencia.
DO $eliminar$
DECLARE
  oid_ oid := to_regprocedure('compi_private.delete_withdrawn_employee(text,uuid,timestamp with time zone)');
  def text; owner_ oid; acl_ aclitem[]; sec_ boolean; cfg_ text[]; new_def text;
  old_line constant text := E'  delete from public.compi_staff where id=target.id;\n';
BEGIN
  SELECT pg_get_functiondef(p.oid), p.proowner, p.proacl, p.prosecdef, p.proconfig INTO def, owner_, acl_, sec_, cfg_ FROM pg_proc p WHERE p.oid = oid_;
  IF md5(def) IS DISTINCT FROM '30a9850a02b3b4aead1f84a2b0feab1e' THEN RAISE EXCEPTION 'delete_withdrawn_employee ha cambiado desde la revision.'; END IF;
  IF (length(def) - length(replace(def, old_line, ''))) / length(old_line) <> 1 THEN RAISE EXCEPTION 'delete_withdrawn_employee: la linea esperada no aparece exactamente una vez.'; END IF;
  new_def := replace(def, old_line, old_line ||
    E'  -- El usuario de acceso se borra solo si no pertenece a otro hotel; si algo lo referencia, se conserva sin error.\n' ||
    E'  if target.user_id is not null\n' ||
    E'     and not exists(select 1 from public.compi_staff where user_id=target.user_id)\n' ||
    E'     and not exists(select 1 from public.compi_memberships where user_id=target.user_id) then\n' ||
    E'    begin\n' ||
    E'      delete from auth.users where id=target.user_id;\n' ||
    E'    exception when foreign_key_violation then null;\n' ||
    E'    end;\n' ||
    E'  end if;\n');
  EXECUTE new_def;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = oid_ AND (p.proowner IS DISTINCT FROM owner_ OR p.proacl IS DISTINCT FROM acl_ OR p.prosecdef IS DISTINCT FROM sec_ OR p.proconfig IS DISTINCT FROM cfg_)) THEN
    RAISE EXCEPTION 'delete_withdrawn_employee: cambiaron propietario o permisos.'; END IF;
END
$eliminar$;

-- 2. Eliminar una fila pendiente (sin cuenta): solo el ejecutivo de ese hotel.
CREATE FUNCTION compi_private.remove_pending_employee(h text, employee uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
declare target public.compi_staff%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(h,731));
  if not compi_private.active_download_session() or compi_private.my_rank(h) is distinct from 1 then raise insufficient_privilege; end if;
  select * into target from public.compi_staff where hotel_key=h and id=employee for update;
  if not found then raise exception using errcode='PT404',message='Empleado no disponible en este hotel.'; end if;
  if target.user_id is not null or target.withdrawn_at is not null then
    raise exception using errcode='PT409',message='El empleado ya tiene cuenta. Actualiza la lista.'; end if;
  if exists(select 1 from auth.users u where lower(u.email)=target.email) then
    raise exception using errcode='PT409',message='Ya existe una cuenta con ese correo. Actualiza la lista.'; end if;
  delete from compi_private.lab_tickets t where t.employee=target.id;
  delete from compi_private.lab_mail_outbox o where o.employee=target.id;
  delete from compi_private.address_allocations where request_id=target.id;
  delete from public.compi_staff where id=target.id;
end $$;
REVOKE ALL ON FUNCTION compi_private.remove_pending_employee(text, uuid) FROM public, anon, authenticated, service_role;
-- Como las demas funciones privadas de este tipo: la funcion publica es un envoltorio que se ejecuta con los permisos de quien llama.
GRANT EXECUTE ON FUNCTION compi_private.remove_pending_employee(text, uuid) TO authenticated;

CREATE FUNCTION public.compi_remove_pending_employee(h text, employee uuid) RETURNS void
 LANGUAGE sql SET search_path TO ''
AS $$ select compi_private.remove_pending_employee(h, employee) $$;
REVOKE ALL ON FUNCTION public.compi_remove_pending_employee(text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.compi_remove_pending_employee(text, uuid) TO authenticated;

COMMIT;
