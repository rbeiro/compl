-- An employee keeps one staff identity, hour balance and leave allowance even
-- when the same schedule is displayed in a second outlet.
create table compi_private.schedule_extra_outlets (
  employee uuid not null references public.compi_staff(id) on delete cascade,
  hotel_key text not null,
  outlet_key text not null,
  primary key (employee, hotel_key, outlet_key),
  foreign key (hotel_key, outlet_key) references public.compi_outlets(hotel_key,outlet_key) on delete cascade
);
create index schedule_extra_by_outlet on compi_private.schedule_extra_outlets(hotel_key,outlet_key);
alter table compi_private.schedule_extra_outlets enable row level security;
revoke all on compi_private.schedule_extra_outlets from public, anon, authenticated;

create or replace function compi_private.schedule_view(h text,month_start date,department text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  me public.compi_staff:=compi_private.schedule_member(h);
  dep text:=lower(trim(coalesce(department,me.outlet_name)));
  until_day date:=(month_start+interval '1 month')::date;
  result jsonb;
begin
  if month_start is null or extract(day from month_start)<>1 then raise invalid_parameter_value;end if;
  if me.access_rank<>1 and dep<>lower(trim(me.outlet_name)) and not exists (
    select 1 from compi_private.schedule_extra_outlets e
    join public.compi_outlets o using (hotel_key,outlet_key)
    where e.employee=me.id and e.hotel_key=h and not o.archived and lower(trim(o.outlet))=dep
  ) then raise insufficient_privilege;end if;

  with team as materialized (
    select s.id,s.employee_name as name,s.position_name as position,s.access_rank as rank,trim(s.outlet_name) as department
    from public.compi_staff s where s.hotel_key=h and s.withdrawn_at is null
  ), assignments as materialized (
    select t.id,t.department from team t
    union
    select t.id,trim(o.outlet) from team t
    join compi_private.schedule_extra_outlets e on e.employee=t.id and e.hotel_key=h
    join public.compi_outlets o using (hotel_key,outlet_key) where not o.archived
  ), roster as materialized (
    select t.* from team t
    where exists (select 1 from assignments a where a.id=t.id and lower(a.department)=dep)
      and lower(trim(t.position)) not in ('chef ejecutivo','chef ejecutiva','executive chef')
  ), balances as (
    select t.id,t.name,t.position,t.rank,t.department,coalesce(sum(b.minutes),0) as total,
      coalesce(max(b.minutes) filter(where b.month=month_start),0) as adjustment,
      max(b.revision::text) filter(where b.month=month_start) as revision
    from team t left join compi_private.schedule_hours b on b.employee=t.id and b.month<=month_start
    where me.access_rank=1 or t.id=me.id group by t.id,t.name,t.position,t.rank,t.department
  )
  select jsonb_build_object(
    'me',me.id,'admin',me.access_rank=1,'dept',dep,
    'departments',(select jsonb_agg(to_jsonb(d) order by d.name) from (
      select lower(a.department) as key,min(a.department) as name from assignments a
      where me.access_rank=1 or a.id=me.id group by lower(a.department)
    ) d),
    'people',coalesce((select jsonb_agg(to_jsonb(r)) from roster r),'[]'),
    'shifts',coalesce((select jsonb_agg(to_jsonb(s)) from compi_private.schedule_shifts s join roster r on r.id=s.employee where s.day>=month_start and s.day<until_day),'[]'),
    'vacations',coalesce((select jsonb_agg(jsonb_build_object('employee',l.employee,'day',v)) from compi_private.schedule_leave l join roster r on r.id=l.employee
      cross join lateral unnest(l.days) v where l.state='approved' and v>=month_start and v<until_day),'[]'),
    'balances',coalesce((select jsonb_agg(to_jsonb(b)) from balances b),'[]'),
    'mine',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'days',l.days,'state',l.state) order by l.created_at desc) from compi_private.schedule_leave l where l.employee=me.id),'[]'),
    'requests',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'name',t.name,'department',t.department,'days',l.days,'state',l.state) order by (l.state='pending') desc,l.created_at)
      from compi_private.schedule_leave l join team t on t.id=l.employee where me.access_rank=1 and (l.state='pending' or exists(select 1 from unnest(l.days) v where v>=month_start and v<until_day))),'[]')
  ) into result;
  return result;
end $$;
;
