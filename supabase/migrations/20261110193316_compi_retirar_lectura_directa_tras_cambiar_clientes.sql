-- Retain the SELECT required by Storage upserts. New downloads go through the
-- session-scoped S3 read policy and cannot populate the old authenticated CDN route.
alter policy read_hotel_guide_files on storage.objects using (
 bucket_id='plating-guides'
 and storage.allow_any_operation(array['object.upload','object.upload_update'])
 and compi_private.my_rank(split_part(storage.objects.name,'/',1)) in (1,2)
 and compi_private.can_write_file(storage.objects.name)
);
;
