-- A trusted operator binds the employee's independently delivered lab credential.
create function public.compi_provision_lab_channel(h text,employee_id uuid,recipient_address text,proof_hash text)
returns void language plpgsql security definer set search_path='' as $$
declare member public.compi_staff;
begin
 select * into member from public.compi_staff where id=employee_id and hotel_key=h for update;
 if not found or member.user_id is not null or member.withdrawn_at is not null or member.email<>recipient_address
    or proof_hash is null or proof_hash !~ '^[a-f0-9]{64}$' then raise insufficient_privilege;end if;
 delete from compi_private.lab_tickets where employee=member.id;
 insert into compi_private.lab_mail_outbox(employee,recipient,expires_at,relay_key_hash)
 values(member.id,member.email,now()+interval '7 days',proof_hash)
 on conflict(employee) do update set expires_at=excluded.expires_at,relay_key_hash=excluded.relay_key_hash,
 message=null,attempt=null,lease_until=null,queued_at=null;
 update public.compi_staff set invite_state='prepared',invite_until=null,invite_revision=gen_random_uuid() where id=member.id;
end $$;
revoke all on function public.compi_provision_lab_channel(text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.compi_provision_lab_channel(text,uuid,text,text) to service_role;
create table compi_private.auth_request_buckets (
 minute timestamptz not null, endpoint text not null, client text not null, attempts int not null,
 primary key(minute,endpoint,client)
);
alter table compi_private.auth_request_buckets enable row level security;
revoke all on compi_private.auth_request_buckets from public,anon,authenticated;
create function public.compi_allow_auth_request(endpoint text,client text) returns boolean language plpgsql security definer set search_path='' as $$
declare slot timestamptz:=date_trunc('minute',clock_timestamp()); count_used int;
begin
 if endpoint is null or endpoint not in ('accept','recover','relay') or client is null or client !~ '^[a-f0-9]{64}$' then return false;end if;
 delete from compi_private.auth_request_buckets b where b.minute<slot-interval '2 minutes';
 insert into compi_private.auth_request_buckets values(slot,endpoint,'all',1)
 on conflict on constraint auth_request_buckets_pkey do update set attempts=auth_request_buckets.attempts+1 returning attempts into count_used;
 if count_used>3000 then return false;end if;
 insert into compi_private.auth_request_buckets values(slot,endpoint,client,1)
 on conflict on constraint auth_request_buckets_pkey do update set attempts=auth_request_buckets.attempts+1 returning attempts into count_used;
 return count_used<=45;
end $$;
revoke all on function public.compi_allow_auth_request(text,text) from public,anon,authenticated;
grant execute on function public.compi_allow_auth_request(text,text) to service_role;
create table compi_private.access_events (
 occurred_at timestamptz not null default now(), hotel text, actor uuid, employee uuid, event text not null
);
alter table compi_private.access_events enable row level security;
revoke all on compi_private.access_events from public,anon,authenticated;
create index access_events_time on compi_private.access_events(occurred_at);
create function compi_private.record_staff_event() returns trigger language plpgsql security definer set search_path='' as $$
declare kind text;
begin
 if tg_op='INSERT' then kind:='registered';
 elsif tg_op='DELETE' then kind:='deleted';
 elsif old.access_rank is distinct from new.access_rank then kind:='rank_changed';
 elsif old.withdrawn_at is distinct from new.withdrawn_at then kind:=case when new.withdrawn_at is null then 'restored' else 'withdrawn' end;
 elsif old.invite_state is distinct from new.invite_state then kind:='invitation_'||coalesce(new.invite_state,'pending');
 else return null;end if;
 insert into compi_private.access_events(hotel,actor,employee,event)
 values(coalesce(new.hotel_key,old.hotel_key),auth.uid(),coalesce(new.id,old.id),kind);
 delete from compi_private.access_events where occurred_at<now()-interval '90 days';
 return null;
end $$;
revoke all on function compi_private.record_staff_event() from public,anon,authenticated;
create trigger compi_record_staff_event after insert or update or delete on public.compi_staff for each row execute function compi_private.record_staff_event();
;
