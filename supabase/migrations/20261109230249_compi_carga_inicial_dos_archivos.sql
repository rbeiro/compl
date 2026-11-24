create policy upload_only_two_pilot_files on storage.objects for insert to authenticated with check (
 (select auth.uid())='b19858ff-064c-4dab-ab42-3b8efaad94b7'::uuid and bucket_id='plating-guides'
 and exists(select 1 from public.compi_memberships m where m.user_id=(select auth.uid()) and m.hotel_key='hotel-arts-barcelona' and m.hotel_key=(storage.foldername(storage.objects.name))[1])
 and name in ('hotel-arts-barcelona/laboratorio-chefi/plating-guides/tosta-de-calabacin-con-limon-prueba/ficha.pdf','hotel-arts-barcelona/laboratorio-chefi/plating-guides/tosta-de-calabacin-con-limon-prueba/ficha.docx')
);;
