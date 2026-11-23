-- VUELTA ATRAS de eliminar-empleado.sql. Una transaccion.
-- Comprueba que delete_withdrawn_employee sigue siendo la version nueva antes de restaurar la original.
BEGIN;
DO $revertir$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('compi_private.delete_withdrawn_employee(text,uuid,timestamp with time zone)'))) IS DISTINCT FROM '3d43026472cf3e556fe026391639c72e' THEN RAISE EXCEPTION 'delete_withdrawn_employee no es la version nueva esperada.'; END IF;
  EXECUTE $orig$CREATE OR REPLACE FUNCTION compi_private.delete_withdrawn_employee(h text, employee uuid, withdrawal timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare target public.compi_staff%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(h,731));
  if not compi_private.active_download_session() or compi_private.my_rank(h) is distinct from 1 then raise insufficient_privilege; end if;
  select * into target from public.compi_staff where hotel_key=h and id=employee for update;
  if not found then raise exception using errcode='PT404',message='Empleado no disponible en este hotel.'; end if;
  if target.withdrawn_at is null or target.withdrawn_at is distinct from withdrawal or
    exists(select 1 from public.compi_memberships where hotel_key=h and user_id=target.user_id) then
    raise exception using errcode='PT409',message='El acceso debe seguir retirado. Actualiza la lista.'; end if;
  delete from public.compi_staff where id=target.id;
end $function$$orig$;
END
$revertir$;
DROP FUNCTION public.compi_remove_pending_employee(text, uuid);
DROP FUNCTION compi_private.remove_pending_employee(text, uuid);
COMMIT;
