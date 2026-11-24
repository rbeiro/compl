-- Password-only executive access is a per-account choice in CompI Laboratorio.
-- Match the original employee, Auth user, and hotel together. A new executive
-- appointment or a recreated account continues to require MFA by default.
create table compi_private.executive_password_only (
  employee_id uuid primary key references public.compi_staff(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  hotel_key text not null,
  created_at timestamptz not null default now()
);
alter table compi_private.executive_password_only enable row level security;
revoke all privileges on table compi_private.executive_password_only
  from public, anon, authenticated, service_role;

create or replace function public.compi_needs_mfa() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt()->>'aal', '') <> 'aal2' and exists (
    select 1
    from public.compi_staff s
    join public.compi_memberships m using (user_id, hotel_key)
    where s.user_id = auth.uid()
      and s.access_rank = 1
      and s.withdrawn_at is null
      and not exists (
        select 1 from compi_private.executive_password_only e
        where e.employee_id = s.id and e.user_id = s.user_id and e.hotel_key = s.hotel_key
          and s.hotel_key = 'hotel-arts-barcelona' and s.email = 'l.ribeiro.ejecutivo@compi.invalid'
      )
  )
$$;
revoke all on function public.compi_needs_mfa() from public, anon;
grant execute on function public.compi_needs_mfa() to authenticated;;
