-- Only this Edge function's three settings may be retrieved through this RPC.
create or replace function public.compi_assistant_settings() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_object_agg(s.env_name, v.decrypted_secret), '{}'::jsonb)
  from (values
    ('compi_assistant_openai_api_key', 'OPENAI_API_KEY'),
    ('compi_assistant_compositor_url', 'COMPI_COMPOSITOR_URL'),
    ('compi_assistant_compositor_token', 'COMPI_COMPOSITOR_TOKEN')
  ) as s(vault_name, env_name)
  join vault.decrypted_secrets as v on v.name = s.vault_name;
$$;
revoke all on function public.compi_assistant_settings() from public, anon, authenticated;
grant execute on function public.compi_assistant_settings() to service_role;;
