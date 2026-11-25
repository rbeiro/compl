-- Demo data for local development (pnpm --filter @compi/api db:local).
-- Sign in with any of these emails and the fake auth password ("compi-dev").
insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values
  ('00000000-0000-4000-8000-000000000001', 'chef@compichef.test', now(), '{}'),
  ('00000000-0000-4000-8000-000000000002', 'cocinero@compichef.test', now(), '{}'),
  ('00000000-0000-4000-8000-000000000003', 'temporal@compichef.test', now(), '{"compi_must_change": "true"}');

insert into public.compi_staff (hotel_key, user_id, email, employee_name, position_name, outlet_name, access_rank) values
  ('hotel-arts-barcelona', '00000000-0000-4000-8000-000000000001', 'chef@compichef.test', 'Chef Ejecutivo', 'Chef ejecutivo', 'Cocina central', 1),
  ('hotel-arts-barcelona', '00000000-0000-4000-8000-000000000002', 'cocinero@compichef.test', 'Ana Cocinera', 'Cocinera', 'Enoteca', 3),
  ('hotel-arts-barcelona', '00000000-0000-4000-8000-000000000003', 'temporal@compichef.test', 'Nuevo Empleado', 'Ayudante', 'P41', 3);

insert into public.compi_memberships (user_id, hotel_key) values
  ('00000000-0000-4000-8000-000000000001', 'hotel-arts-barcelona'),
  ('00000000-0000-4000-8000-000000000002', 'hotel-arts-barcelona'),
  ('00000000-0000-4000-8000-000000000003', 'hotel-arts-barcelona');

insert into public.compi_arts_outlets (hotel_key, outlet_key, hotel, outlet) values
  ('hotel-arts-barcelona', 'enoteca', 'Hotel Arts Barcelona', 'Enoteca'),
  ('hotel-arts-barcelona', 'p41', 'Hotel Arts Barcelona', 'P41');

insert into public.compi_arts_guides (hotel_key, outlet_key, guide_key, hotel, outlet, title, guide_state) values
  ('hotel-arts-barcelona', 'enoteca', 'arroz-de-carabinero', 'Hotel Arts Barcelona', 'Enoteca', 'Arroz de carabinero', 'ready'),
  ('hotel-arts-barcelona', 'enoteca', 'tartar-de-atun', 'Hotel Arts Barcelona', 'Enoteca', 'Tartar de atún', 'ready'),
  ('hotel-arts-barcelona', 'p41', 'ostra-y-manzana', 'Hotel Arts Barcelona', 'P41', 'Ostra y manzana', 'ready');
