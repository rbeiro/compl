-- Demo data for local development (pnpm --filter @compi/api db:local).
-- Every demo user signs in with the password "compi-dev".
insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, encrypted_password) values
  ('00000000-0000-4000-8000-000000000001', 'chef@compichef.com', now(), '{}', extensions.crypt('compi-dev', extensions.gen_salt('bf', 4))),
  ('00000000-0000-4000-8000-000000000002', 'cocinero@compichef.com', now(), '{}', extensions.crypt('compi-dev', extensions.gen_salt('bf', 4))),
  ('00000000-0000-4000-8000-000000000003', 'temporal@compichef.com', now(), '{"compi_must_change": "true"}', extensions.crypt('compi-dev', extensions.gen_salt('bf', 4)));

insert into public.compi_staff (hotel_key, user_id, email, employee_name, position_name, outlet_name, access_rank) values
  ('hotel-arts-barcelona', '00000000-0000-4000-8000-000000000001', 'chef@compichef.com', 'Chef Ejecutivo', 'Chef ejecutivo', 'Cocina central', 1),
  ('hotel-arts-barcelona', '00000000-0000-4000-8000-000000000002', 'cocinero@compichef.com', 'Ana Cocinera', 'Cocinera', 'Enoteca', 3),
  ('hotel-arts-barcelona', '00000000-0000-4000-8000-000000000003', 'temporal@compichef.com', 'Nuevo Empleado', 'Ayudante', 'P41', 3);

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
