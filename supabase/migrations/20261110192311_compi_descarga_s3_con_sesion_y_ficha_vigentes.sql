-- S3 session-token downloads are authorized at Storage with the employee identity.
create function compi_private.active_download_session() returns boolean
language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from auth.sessions s
     where s.id::text = (auth.jwt()->>'session_id')
       and s.user_id = (select auth.uid())
       and (s.not_after is null or s.not_after > now())
  );
$$;
revoke all on function compi_private.active_download_session() from public,anon;
grant execute on function compi_private.active_download_session() to authenticated;

create policy compi_read_current_file on storage.objects for select to authenticated using (
 bucket_id='plating-guides'
 and storage.allow_only_operation('s3.object.get')
 and (select compi_private.active_download_session())
 and exists (
   select 1 from public.compi_memberships m
   join public.compi_guides g on g.hotel_key=m.hotel_key
   join public.compi_outlets o on o.hotel_key=g.hotel_key and o.outlet_key=g.outlet_key
   where m.user_id=(select auth.uid()) and m.hotel_key=(storage.foldername(storage.objects.name))[1]
     and compi_private.my_rank(m.hotel_key) in (1,2,3)
     and not o.archived and g.guide_state='ready'
     and storage.objects.name in (g.object_prefix||'ficha.pdf',g.object_prefix||'ficha.docx')
 )
);
;
