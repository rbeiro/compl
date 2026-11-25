-- Fixed server-side art reference. Chunks allow controlled provisioning over
-- the management API. A partial upload can never be returned as a valid master.
create table compi_private.acuarela_master_chunks (
  part smallint primary key check (part >= 0), data bytea not null
);
alter table compi_private.acuarela_master_chunks enable row level security;
revoke all on compi_private.acuarela_master_chunks from public, anon, authenticated, service_role;

create function public.compi_acuarela_master() returns text
language sql stable security definer set search_path='' as $$
  select replace(encode(png,'base64'), E'\n','') from (
    select string_agg(data,''::bytea order by part) png from compi_private.acuarela_master_chunks
  ) art where encode(sha256(png),'hex')='b4a603e32ec54fd9e324ce082256ab3726bb158ced02103dfa81886a964e551f';
$$;
revoke all on function public.compi_acuarela_master() from public, anon, authenticated;
grant execute on function public.compi_acuarela_master() to service_role;
;
