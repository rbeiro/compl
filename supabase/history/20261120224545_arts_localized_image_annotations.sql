create table if not exists compi_private.arts_image_labels (
  hotel_key text not null, outlet_key text not null, guide_key text not null,
  sha text not null check (length(sha)=64), labels jsonb not null,
  primary key(hotel_key,outlet_key,guide_key)
);
alter table compi_private.arts_image_labels enable row level security;
revoke all on compi_private.arts_image_labels from public, anon, authenticated;
create or replace function public.compi_arts_image_labels(h text,o text,g text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform compi_private.arts_workspace_access(h,o,g,false);
  return (select jsonb_build_object('sha',a.sha,'labels',a.labels)
    from compi_private.arts_image_labels a where (a.hotel_key,a.outlet_key,a.guide_key)=(h,o,g));
end $$;
revoke all on function public.compi_arts_image_labels(text,text,text) from public,anon;
grant execute on function public.compi_arts_image_labels(text,text,text) to authenticated;
;
