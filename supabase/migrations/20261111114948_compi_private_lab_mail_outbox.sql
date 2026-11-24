-- Private transport for short-lived, preconfigured test mailboxes.
create table compi_private.lab_mail_outbox (
  employee uuid primary key references public.compi_staff(id) on delete cascade,
  recipient text not null unique check (recipient ~ '^buzon-[0-9a-f]{16}@compi[.]invalid$'),
  expires_at timestamptz not null,
  attempt uuid,
  lease_until timestamptz,
  message text,
  queued_at timestamptz
);
alter table compi_private.lab_mail_outbox enable row level security;
revoke all on compi_private.lab_mail_outbox from public, anon, authenticated;

create function public.compi_lab_mail_reserve(p_employee uuid, p_recipient text, p_attempt uuid)
returns text language plpgsql security definer set search_path='' as $$
declare slot compi_private.lab_mail_outbox%rowtype;
begin
  select * into slot from compi_private.lab_mail_outbox
   where employee=p_employee and recipient=p_recipient and expires_at>clock_timestamp() for update;
  if not found then return 'unavailable'; end if;
  if slot.queued_at is not null then return 'queued'; end if;
  if slot.lease_until>clock_timestamp() then return 'busy'; end if;
  update compi_private.lab_mail_outbox set attempt=p_attempt, lease_until=clock_timestamp()+interval '2 minutes'
    where employee=p_employee;
  return 'reserved';
end $$;

create function public.compi_lab_mail_finish(p_employee uuid,p_attempt uuid,p_message text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_message is not null and length(p_message) not between 100 and 12000 then return false; end if;
  update compi_private.lab_mail_outbox
  set message=p_message, queued_at=case when p_message is not null then clock_timestamp() end,
      attempt=null, lease_until=null
  where employee=p_employee and attempt=p_attempt and queued_at is null and expires_at>clock_timestamp();
  return found;
end $$;
revoke all on function public.compi_lab_mail_reserve(uuid,text,uuid), public.compi_lab_mail_finish(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.compi_lab_mail_reserve(uuid,text,uuid), public.compi_lab_mail_finish(uuid,uuid,text) to service_role;
;
