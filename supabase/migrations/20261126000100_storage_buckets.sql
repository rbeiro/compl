-- Private storage buckets used by the CompI database functions and the API.
-- All access goes through the API with server credentials after the database
-- authorizes it (compi_*_file_access, compi_*_workspace_media), so the buckets
-- are private and need no storage policies.
-- Supabase-specific: on other hosts, create the same buckets in the S3 store.
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  insert into storage.buckets (id, name, public) values
    ('plating-guides', 'plating-guides', false),
    ('compi-guide-media', 'compi-guide-media', false),
    ('compi-arts-catalog', 'compi-arts-catalog', false),
    ('compi-arts-media', 'compi-arts-media', false)
  on conflict (id) do nothing;
end $$;
