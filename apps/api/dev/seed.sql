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

-- Internal mail: a conversation between the two demo cooks, a draft and a folder.
with s as (select id, email from public.compi_staff where hotel_key = 'hotel-arts-barcelona')
insert into compi_private.mail_folders (owner, id, label)
select id, '00000000-0000-4000-9000-000000000001', 'Proveedores' from s where email = 'cocinero@compichef.com';

with s as (select id, email from public.compi_staff where hotel_key = 'hotel-arts-barcelona'),
chef as (select id from s where email = 'chef@compichef.com'),
cook as (select id from s where email = 'cocinero@compichef.com')
insert into compi_private.mail_items (owner, origin, folder, starred, unread, sender, recipients, subject, body, updated_at)
select (select id from cook), 'inbox', null::uuid, false, true, 'chef@compichef.com', 'cocinero@compichef.com',
  'Cambio en el pase de la Enoteca', E'Hola Ana:\n\nA partir del lunes el arroz de carabinero sale con el alioli a la derecha. Revisa la guía actualizada.\n\nGracias.', '2026-11-20 09:15+01'::timestamptz
union all
select (select id from cook), 'inbox', null, true, false, 'chef@compichef.com', 'cocinero@compichef.com',
  'Turnos de diciembre', E'Ya están publicados los turnos de diciembre en Horarios.', '2026-11-18 17:40+01'
union all
select (select id from cook), 'inbox', '00000000-0000-4000-9000-000000000001', false, false, 'chef@compichef.com', 'cocinero@compichef.com',
  'Pedido de ostras', E'El proveedor confirma la entrega del jueves.', '2026-11-15 11:05+01'
union all
select (select id from cook), 'sent', null, false, false, 'cocinero@compichef.com', 'chef@compichef.com',
  'Re: Turnos de diciembre', E'Recibido, gracias.', '2026-11-18 18:02+01'
union all
select (select id from cook), 'drafts', null, false, false, 'cocinero@compichef.com', 'chef@compichef.com',
  'Vacaciones', E'Quería pedir la semana del', '2026-11-21 10:30+01'
union all
select (select id from chef), 'sent', null, false, false, 'chef@compichef.com', 'cocinero@compichef.com',
  'Cambio en el pase de la Enoteca', E'Hola Ana:\n\nA partir del lunes el arroz de carabinero sale con el alioli a la derecha. Revisa la guía actualizada.\n\nGracias.', '2026-11-20 09:15+01'
union all
select (select id from chef), 'inbox', null, false, true, 'cocinero@compichef.com', 'chef@compichef.com',
  'Re: Turnos de diciembre', E'Recibido, gracias.', '2026-11-18 18:02+01';

-- Schedules: a small Enoteca brigade with shifts for the current month, leave and hours balances.
insert into public.compi_staff (hotel_key, user_id, email, employee_name, position_name, outlet_name, access_rank) values
  ('hotel-arts-barcelona', null, 'marc@compichef.com', 'Marc Puig', 'Sous chef', 'Enoteca', 2),
  ('hotel-arts-barcelona', null, 'laia@compichef.com', 'Laia Serra', 'Jefe de partida', 'Enoteca', 3),
  ('hotel-arts-barcelona', null, 'pau@compichef.com', 'Pau Vidal', 'Ayudante de cocina', 'Enoteca', 3);

insert into compi_private.schedule_shifts (employee, day, kind, starts, ends)
select s.id, d::date,
  case when extract(isodow from d) in (6, 7) then 'off' else 'work' end,
  case when extract(isodow from d) in (6, 7) then null
       when s.email = 'marc@compichef.com' then '16:00'::time else '08:00'::time end,
  case when extract(isodow from d) in (6, 7) then null
       when s.email = 'marc@compichef.com' then '00:30'::time else '16:00'::time end
from public.compi_staff s
cross join generate_series(date_trunc('month', now() at time zone 'Europe/Madrid'),
  date_trunc('month', now() at time zone 'Europe/Madrid') + interval '1 month - 1 day', interval '1 day') d
where s.hotel_key = 'hotel-arts-barcelona' and s.outlet_name = 'Enoteca'
  and not (s.email = 'cocinero@compichef.com' and extract(day from d) in (10, 11));

insert into compi_private.schedule_leave (id, employee, days, state)
select '00000000-0000-4000-a000-000000000001'::uuid, id,
  array[(date_trunc('month', now() at time zone 'Europe/Madrid') + interval '9 days')::date,
        (date_trunc('month', now() at time zone 'Europe/Madrid') + interval '10 days')::date], 'approved'
from public.compi_staff where email = 'cocinero@compichef.com'
union all
select '00000000-0000-4000-a000-000000000002'::uuid, id,
  array[(date_trunc('month', now() at time zone 'Europe/Madrid') + interval '1 month 4 days')::date], 'pending'
from public.compi_staff where email = 'cocinero@compichef.com';

insert into compi_private.schedule_hours (employee, month, minutes)
select id, (date_trunc('month', now() at time zone 'Europe/Madrid') - interval '1 month')::date, 90
from public.compi_staff where email = 'cocinero@compichef.com';
