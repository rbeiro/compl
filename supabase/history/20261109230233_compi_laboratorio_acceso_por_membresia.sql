create table public.compi_memberships (
 user_id uuid not null references auth.users(id) on delete cascade,
 hotel_key text not null check (hotel_key ~ '^[a-z0-9-]+$'),
 primary key (user_id, hotel_key)
);
create table public.compi_guides (
 hotel_key text not null check (hotel_key ~ '^[a-z0-9-]+$'),
 outlet_key text not null check (outlet_key ~ '^[a-z0-9-]+$'),
 guide_key text not null check (guide_key ~ '^[a-z0-9-]+$'),
 hotel text not null, outlet text not null, title text not null,
 object_prefix text generated always as (hotel_key || '/' || outlet_key || '/plating-guides/' || guide_key || '/') stored,
 primary key(hotel_key,outlet_key,guide_key)
);
alter table public.compi_memberships enable row level security;
alter table public.compi_guides enable row level security;
revoke all privileges on public.compi_memberships, public.compi_guides from public, anon, authenticated;
grant select on public.compi_memberships, public.compi_guides to authenticated;
create policy read_own_hotel_memberships on public.compi_memberships for select to authenticated using (user_id = (select auth.uid()));
create policy read_hotel_guides on public.compi_guides for select to authenticated using (
 exists(select 1 from public.compi_memberships m where m.user_id=(select auth.uid()) and m.hotel_key=compi_guides.hotel_key)
);
create policy read_hotel_guide_files on storage.objects for select to authenticated using (
 bucket_id='plating-guides'
 and exists (select 1 from public.compi_memberships m join public.compi_guides g on g.hotel_key=m.hotel_key
 where m.user_id=(select auth.uid()) and m.hotel_key=(storage.foldername(storage.objects.name))[1]
 and storage.objects.name in (g.object_prefix || 'ficha.docx',g.object_prefix || 'ficha.pdf'))
);
insert into public.compi_memberships (user_id,hotel_key) values
 ('b19858ff-064c-4dab-ab42-3b8efaad94b7','hotel-arts-barcelona'),
 ('2bfa64d0-5568-4324-b4df-39d8966c4b21','otro-hotel-prueba');
insert into public.compi_guides (hotel_key,outlet_key,guide_key,hotel,outlet,title) values
 ('hotel-arts-barcelona','laboratorio-chefi','tosta-de-calabacin-con-limon-prueba','Hotel Arts Barcelona','Laboratorio Chefi','Tosta de Calabacín con Limón (Prueba)');;
