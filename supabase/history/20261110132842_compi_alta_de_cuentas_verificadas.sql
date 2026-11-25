create or replace function compi_private.staff_change(h text, op text, item jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare r int := (item->>'rank')::int; old_rank int; target uuid; verified_user uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(h,731));
  if compi_private.my_rank(h) is distinct from 1 then raise insufficient_privilege; end if;
  if r is null or r not between 1 and 3 then raise exception using errcode='22023',message='Rango inválido'; end if;
  if op='register' then
    if coalesce(item->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception using errcode='22023',message='Correo inválido';
    end if;
    select u.id into verified_user from auth.users u where lower(u.email)=lower(btrim(item->>'email')) and u.email_confirmed_at is not null;
    insert into public.compi_staff(hotel_key,employee_name,email,position_name,outlet_name,access_rank,user_id)
      values(h,btrim(item->>'name'),lower(btrim(item->>'email')),btrim(item->>'position'),btrim(item->>'outlet'),r,verified_user);
    if verified_user is not null then
      insert into public.compi_memberships(user_id,hotel_key) values(verified_user,h) on conflict do nothing;
    end if;
  elsif op='rank' then
    select access_rank,user_id into old_rank,target from public.compi_staff where hotel_key=h and id=(item->>'id')::uuid for update;
    if not found then raise insufficient_privilege; end if;
    if old_rank is distinct from (item->>'previous')::int then raise exception using errcode='PT409',message='Otro usuario ha modificado el rango'; end if;
    if old_rank=1 and r<>1 and target is not null and not exists
      (select 1 from public.compi_staff where hotel_key=h and access_rank=1 and user_id is not null and user_id<>target) then
      raise exception using errcode='PT409',message='Debe quedar un administrador activo en el hotel';
    end if;
    update public.compi_staff set access_rank=r where hotel_key=h and id=(item->>'id')::uuid;
  else raise exception using errcode='22023',message='Operación inválida'; end if;
end $$;
;
