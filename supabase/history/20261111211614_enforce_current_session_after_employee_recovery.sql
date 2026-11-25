-- An already-issued access token must stop authorizing the portal after recovery.
create or replace function compi_private.my_rank(h text) returns smallint
language sql stable security definer set search_path='' as $$
  select s.access_rank from public.compi_staff s join public.compi_memberships m using(user_id,hotel_key)
   where s.hotel_key=h and s.user_id=(select auth.uid()) and s.withdrawn_at is null
     and (select compi_private.active_download_session())
$$;
create policy staff_current_session on public.compi_staff as restrictive for select to authenticated
  using ((select compi_private.active_download_session()));
create policy membership_current_session on public.compi_memberships as restrictive for select to authenticated
  using ((select compi_private.active_download_session()));
create or replace function public.compi_activate_access() returns void language plpgsql security invoker set search_path='' as $$
begin
  if not compi_private.active_download_session() then raise exception using errcode='PT401',message='Vuelve a iniciar sesión.'; end if;
  perform compi_private.claim_staff();
end $$;
create or replace function public.compi_my_access() returns table(hotel_key text,access_rank smallint)
language plpgsql stable security invoker set search_path='' as $$
begin
  if not compi_private.active_download_session() then raise exception using errcode='PT401',message='Vuelve a iniciar sesión.'; end if;
  return query select s.hotel_key,s.access_rank from public.compi_staff s join public.compi_memberships m using(user_id,hotel_key)
    where s.user_id=(select auth.uid()) and s.withdrawn_at is null order by s.hotel_key;
end $$;;
