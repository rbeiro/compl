-- A staff registration identifies the employee within a hotel. Each write takes
-- that employee's row lock, so concurrent edits and leave requests are serialized.
create table compi_private.schedule_shifts(
 employee uuid references public.compi_staff(id) on delete cascade,
 day date, kind text not null check(kind in ('work','off')), starts time, ends time,
 revision uuid not null default gen_random_uuid(), primary key(employee,day),
 check((kind='off' and starts is null and ends is null) or
       (kind='work' and starts is not null and ends is not null and starts<>ends))
);
create table compi_private.schedule_hours(
 employee uuid references public.compi_staff(id) on delete cascade,
 month date check(extract(day from month)=1), minutes int not null,
 revision uuid not null default gen_random_uuid(),primary key(employee,month)
);
create table compi_private.schedule_leave(
 id uuid primary key,employee uuid not null references public.compi_staff(id) on delete cascade,
 days date[] not null check(cardinality(days)>0),state text not null default 'pending' check(state in ('pending','approved','rejected')),
 created_at timestamptz not null default now(),decided_at timestamptz,decided_by uuid references public.compi_staff(id) on delete set null
);
create index schedule_leave_employee on compi_private.schedule_leave(employee,state);
alter table compi_private.schedule_shifts enable row level security;
alter table compi_private.schedule_hours enable row level security;
alter table compi_private.schedule_leave enable row level security;
revoke all on compi_private.schedule_shifts,compi_private.schedule_hours,compi_private.schedule_leave from public,anon,authenticated;

create function compi_private.schedule_member(h text) returns public.compi_staff
language plpgsql stable security definer set search_path='' as $$
declare me public.compi_staff;
begin
 select s.* into me from public.compi_staff s join public.compi_memberships m using(hotel_key,user_id)
 where s.hotel_key=h and s.user_id=auth.uid() and s.withdrawn_at is null and compi_private.active_download_session();
 if not found then raise insufficient_privilege;end if;
 return me;
end $$;
revoke all on function compi_private.schedule_member(text) from public,anon,authenticated;

create function compi_private.schedule_view(h text,month_start date,department text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare me public.compi_staff:=compi_private.schedule_member(h); dep text; until_day date:= (month_start+interval '1 month')::date; result jsonb;
begin
 if month_start is null or extract(day from month_start)<>1 then raise invalid_parameter_value;end if;
 dep:=lower(trim(coalesce(department,me.outlet_name)));
 if me.access_rank<>1 and dep<>lower(trim(me.outlet_name)) then raise insufficient_privilege;end if;
 with team as materialized (select s.id,s.employee_name as name,s.position_name as position,trim(s.outlet_name) as department,
   lower(trim(s.outlet_name)) as dept from public.compi_staff s where s.hotel_key=h and s.withdrawn_at is null),
 roster as (select * from team where dept=dep),
 balances as (select t.id,t.name,t.position,t.department,coalesce(sum(b.minutes),0) as total,
   coalesce(max(b.minutes) filter(where b.month=month_start),0) as adjustment,
   max(b.revision::text) filter(where b.month=month_start) as revision
   from team t left join compi_private.schedule_hours b on b.employee=t.id and b.month<=month_start
   where me.access_rank=1 or t.id=me.id group by t.id,t.name,t.position,t.department)
 select jsonb_build_object('me',me.id,'admin',me.access_rank=1,'dept',dep,
  'departments',(select jsonb_agg(to_jsonb(d) order by d.name) from (select dept as key,min(department) as name from team where me.access_rank=1 or dept=dep group by dept)d),
  'people',coalesce((select jsonb_agg(to_jsonb(r)-'dept') from roster r),'[]'),
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

create function compi_private.schedule_edit(h text,employee_id uuid,work_day date,kind text,start_time time,end_time time,previous uuid)
returns void language plpgsql security definer set search_path='' as $$
declare me public.compi_staff:=compi_private.schedule_member(h); old_shift compi_private.schedule_shifts;
begin
 if me.access_rank<>1 then raise insufficient_privilege;end if;
 perform 1 from public.compi_staff where id=employee_id and hotel_key=h and withdrawn_at is null for update;
 if not found then raise insufficient_privilege;end if;
 if work_day is null or kind is null or kind not in ('work','off','clear') then raise invalid_parameter_value;end if;
 if kind='work' and (start_time is null or end_time is null or start_time=end_time) then raise exception using errcode='22023',message='Introduce una hora de entrada y otra de salida distintas.';end if;
 if kind<>'work' then start_time:=null;end_time:=null;end if;
 if exists(select 1 from compi_private.schedule_leave l where l.employee=employee_id and l.state='approved' and work_day=any(l.days))
   then raise exception using errcode='PT409',message='El empleado tiene vacaciones aprobadas para ese día.';end if;
 select * into old_shift from compi_private.schedule_shifts where employee=employee_id and day=work_day;
 if (old_shift.kind,old_shift.starts,old_shift.ends) is not distinct from (kind,start_time,end_time) or (old_shift.employee is null and kind='clear') then return;end if;
 if old_shift.revision is distinct from previous then raise exception using errcode='PT409',message='El turno ha cambiado. Revisa el cuadrante actualizado.';end if;
 if kind='clear' then delete from compi_private.schedule_shifts where employee=employee_id and day=work_day;
 else insert into compi_private.schedule_shifts(employee,day,kind,starts,ends) values(employee_id,work_day,kind,start_time,end_time)
  on conflict(employee,day) do update set kind=excluded.kind,starts=excluded.starts,ends=excluded.ends,revision=gen_random_uuid();
 end if;
end $$;

create function compi_private.schedule_balance(h text,employee_id uuid,month_start date,adjustment int,previous uuid)
returns void language plpgsql security definer set search_path='' as $$
declare me public.compi_staff:=compi_private.schedule_member(h); old_balance compi_private.schedule_hours;
begin
 if me.access_rank<>1 then raise insufficient_privilege;end if;
 perform 1 from public.compi_staff where id=employee_id and hotel_key=h and withdrawn_at is null for update;
 if not found then raise insufficient_privilege;end if;
 if month_start is null or extract(day from month_start)<>1 or adjustment is null then raise invalid_parameter_value;end if;
 select * into old_balance from compi_private.schedule_hours where employee=employee_id and month=month_start;
 if coalesce(old_balance.minutes,0)=adjustment then return;end if;
 if old_balance.revision is distinct from previous then raise exception using errcode='PT409',message='El saldo ha cambiado. Revisa la tabla actualizada.';end if;
 insert into compi_private.schedule_hours(employee,month,minutes) values(employee_id,month_start,adjustment)
 on conflict(employee,month) do update set minutes=excluded.minutes,revision=gen_random_uuid();
end $$;

create function compi_private.schedule_request(h text,request_id uuid,requested date[]) returns void
language plpgsql security definer set search_path='' as $$
declare me public.compi_staff:=compi_private.schedule_member(h); chosen date[]; existing compi_private.schedule_leave;
begin
 perform 1 from public.compi_staff where id=me.id and withdrawn_at is null for update;
 if not found then raise insufficient_privilege;end if;
 select array_agg(distinct d order by d) into chosen from unnest(requested) d;
 if request_id is null or coalesce(cardinality(chosen),0)=0 or array_position(chosen,null::date) is not null then raise invalid_parameter_value;end if;
 select * into existing from compi_private.schedule_leave where id=request_id;
 if found then
  if existing.employee=me.id and existing.days=chosen then return;end if;
  raise insufficient_privilege;
 end if;
 if exists(select 1 from compi_private.schedule_leave where employee=me.id and state<>'rejected' and days && chosen) then
  raise exception using errcode='PT409',message='Hay días que ya has solicitado. Revisa la selección.';end if;
 if exists(with all_days as (select d from unnest(chosen) d union all
   select d from compi_private.schedule_leave l cross join lateral unnest(l.days) d where l.employee=me.id and l.state<>'rejected')
   select 1 from all_days group by extract(year from d) having count(*)>45) then
  raise exception using errcode='22023',message='La selección supera los 45 días disponibles en un año.';end if;
 insert into compi_private.schedule_leave(id,employee,days) values(request_id,me.id,chosen);
end $$;

create function compi_private.schedule_decide(h text,request_id uuid,decision text) returns void
language plpgsql security definer set search_path='' as $$
declare me public.compi_staff:=compi_private.schedule_member(h); item compi_private.schedule_leave;
begin
 if me.access_rank<>1 then raise insufficient_privilege;end if;
 if decision is null or decision not in ('approved','rejected') then raise invalid_parameter_value;end if;
 perform 1 from public.compi_staff s join compi_private.schedule_leave l on l.employee=s.id where l.id=request_id and s.hotel_key=h and s.withdrawn_at is null for update of s;
 if not found then raise insufficient_privilege;end if;
 select * into item from compi_private.schedule_leave where id=request_id for update;
 if item.state=decision then return;end if;
 if item.state<>'pending' then raise exception using errcode='PT409',message='Esta solicitud ya tiene una decisión.';end if;
 update compi_private.schedule_leave set state=decision,decided_at=now(),decided_by=me.id where id=request_id;
end $$;

create function public.compi_schedule_view(h text,month_start date,department text) returns jsonb language sql security invoker set search_path='' as $$
 select compi_private.schedule_view(h,month_start,department)
$$;
revoke all on function compi_private.schedule_view(text,date,text),public.compi_schedule_view(text,date,text) from public,anon;
grant execute on function compi_private.schedule_view(text,date,text),public.compi_schedule_view(text,date,text) to authenticated;

create function public.compi_schedule_edit(h text,employee_id uuid,work_day date,kind text,start_time time,end_time time,previous uuid) returns void language sql security invoker set search_path='' as $$
 select compi_private.schedule_edit(h,employee_id,work_day,kind,start_time,end_time,previous)
$$;
revoke all on function compi_private.schedule_edit(text,uuid,date,text,time,time,uuid),public.compi_schedule_edit(text,uuid,date,text,time,time,uuid) from public,anon;
grant execute on function compi_private.schedule_edit(text,uuid,date,text,time,time,uuid),public.compi_schedule_edit(text,uuid,date,text,time,time,uuid) to authenticated;

create function public.compi_schedule_balance(h text,employee_id uuid,month_start date,adjustment int,previous uuid) returns void language sql security invoker set search_path='' as $$
 select compi_private.schedule_balance(h,employee_id,month_start,adjustment,previous)
$$;
revoke all on function compi_private.schedule_balance(text,uuid,date,int,uuid),public.compi_schedule_balance(text,uuid,date,int,uuid) from public,anon;
grant execute on function compi_private.schedule_balance(text,uuid,date,int,uuid),public.compi_schedule_balance(text,uuid,date,int,uuid) to authenticated;

create function public.compi_schedule_request(h text,request_id uuid,requested date[]) returns void language sql security invoker set search_path='' as $$
 select compi_private.schedule_request(h,request_id,requested)
$$;
revoke all on function compi_private.schedule_request(text,uuid,date[]),public.compi_schedule_request(text,uuid,date[]) from public,anon;
grant execute on function compi_private.schedule_request(text,uuid,date[]),public.compi_schedule_request(text,uuid,date[]) to authenticated;

create function public.compi_schedule_decide(h text,request_id uuid,decision text) returns void language sql security invoker set search_path='' as $$
 select compi_private.schedule_decide(h,request_id,decision)
$$;
revoke all on function compi_private.schedule_decide(text,uuid,text),public.compi_schedule_decide(text,uuid,text) from public,anon;
grant execute on function compi_private.schedule_decide(text,uuid,text),public.compi_schedule_decide(text,uuid,text) to authenticated;;
