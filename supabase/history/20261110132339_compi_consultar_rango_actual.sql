create function public.compi_my_access() returns table(hotel_key text,access_rank smallint) language sql stable security invoker set search_path='' as $$
select s.hotel_key,s.access_rank from public.compi_staff s join public.compi_memberships m on m.user_id=s.user_id and m.hotel_key=s.hotel_key where s.user_id=(select auth.uid()) order by s.hotel_key;
$$;
revoke all on function public.compi_my_access() from public,anon; grant execute on function public.compi_my_access() to authenticated;;
