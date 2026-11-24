-- Only rows enrolled in the v7 invitation flow are subject to its claim guard.
alter table public.compi_staff add column invite_state text,
 add column invite_until timestamptz, add column invite_revision uuid;
alter table compi_private.lab_mail_outbox add column relay_key_hash text;
create table compi_private.lab_tickets(
 employee uuid primary key references public.compi_staff(id) on delete cascade,
 digest bytea not null unique, attempt uuid, lease_until timestamptz);
revoke all on compi_private.lab_tickets from public,anon,authenticated;
alter table compi_private.lab_tickets enable row level security;

create or replace function compi_private.claim_staff() returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); addr text; h text;
begin
 select lower(email) into addr from auth.users where id=uid and email_confirmed_at is not null;
 for h in update public.compi_staff set user_id=uid where user_id is null and withdrawn_at is null
   and invite_state is null and email=addr returning hotel_key loop
  insert into public.compi_memberships(user_id,hotel_key) values(uid,h) on conflict do nothing;
 end loop;
end $$;

create function public.compi_manage_invitation(h text, employee uuid, op text, previous uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.compi_staff%rowtype; box compi_private.lab_mail_outbox%rowtype; mailed boolean;
 ticket text; rev uuid:=gen_random_uuid(); deadline timestamptz; mime text; body text; st text;
begin
 if not compi_private.active_download_session() or compi_private.my_rank(h) is distinct from 1 then raise insufficient_privilege; end if;
 select * into s from public.compi_staff where id=employee and hotel_key=h for update;
 if not found or s.email !~ '^[a-z0-9._+-]+@compi[.]invalid$' then raise insufficient_privilege; end if;
 if s.user_id is not null or s.withdrawn_at is not null then raise exception using errcode='PT409',message='El empleado ya está activo o retirado. Actualiza la lista.'; end if;
 mailed:=s.email ~ '^buzon-[0-9a-f]{16}@compi[.]invalid$';
 if op='send' and mailed and s.invite_state in ('queued','delivered') and s.invite_until>now() then
  return jsonb_build_object('queued',true,'state',s.invite_state);
 end if;
 if op is null or op not in ('send','replace','cancel') or s.invite_revision is distinct from previous then
  raise exception using errcode='PT409',message='La invitación ha cambiado. Actualiza la lista.';
 end if;
 select * into box from compi_private.lab_mail_outbox b where b.employee=s.id for update;
 if op='cancel' then
  delete from compi_private.lab_tickets t where t.employee=s.id;
  update compi_private.lab_mail_outbox b set message=null,attempt=null,lease_until=null,queued_at=null where b.employee=s.id;
  update public.compi_staff set invite_state='cancelled',invite_until=null,invite_revision=rev where id=s.id;
  return jsonb_build_object('state','cancelled');
 end if;
 if op='send' and s.invite_state is not null then raise exception using errcode='PT409',message='Utiliza Reenviar invitación.'; end if;
 if mailed and (box.employee is null or box.recipient<>s.email or box.expires_at<=now()) then
  raise exception using errcode='PT409',message='El buzón de Laboratorio no está disponible.';
 end if;
 ticket:='v7_'||replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 deadline:=now()+interval '1 hour';
 insert into compi_private.lab_tickets(employee,digest) values(s.id,sha256(convert_to(ticket,'UTF8')))
 on conflict on constraint lab_tickets_pkey do update set digest=excluded.digest,attempt=null,lease_until=null;
 if mailed then
  deadline:=least(deadline,box.expires_at);
  body:='Has recibido una invitación a CompI Laboratorio.'||E'\r\n\r\n'||'Abre el enlace para establecer tu contraseña:'||E'\r\n'||
   'https://compi-laboratorio.leonardo-vincere.chatgpt.site/invitacion.html#'||ticket||E'\r\n\r\n'||'El enlace es de un solo uso.';
  mime:=concat_ws(E'\r\n','From: CompI Laboratorio <invitaciones@compi.invalid>','To: '||s.email,
   'Subject: =?UTF-8?B?VHUgaW52aXRhY2nDs24gYSBDb21wSSBMYWJvcmF0b3Jpbw==?=',
   'Message-ID: <'||rev||'@compi.invalid>','Date: '||to_char(now() at time zone 'UTC','Dy, DD Mon YYYY HH24:MI:SS')||' +0000',
   'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',
   replace(encode(convert_to(body,'UTF8'),'base64'),E'\n',E'\r\n'),'');
  update compi_private.lab_mail_outbox b set message=mime,queued_at=now(),attempt=null,lease_until=null where b.employee=s.id;
 end if;
 st:=case when mailed then 'queued' else 'issued' end;
 update public.compi_staff set invite_state=st,invite_until=deadline,invite_revision=rev where id=s.id;
 if mailed then return jsonb_build_object('queued',true,'state',st); end if;
 return jsonb_build_object('token_hash',ticket,'state',st);
end $$;
revoke all on function public.compi_manage_invitation(text,uuid,text,uuid) from public,anon;
grant execute on function public.compi_manage_invitation(text,uuid,text,uuid) to authenticated;

-- The worker must know the independent per-mailbox secret. Claim and acknowledgement
-- are versioned so a late acknowledgement cannot mark a replacement as delivered.
create function public.compi_lab_relay(addr text, proof text, receipt uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid; s public.compi_staff%rowtype; b compi_private.lab_mail_outbox%rowtype; a uuid:=gen_random_uuid();
begin
 if length(proof)<>64 or addr !~ '^buzon-[0-9a-f]{16}@compi[.]invalid$' then raise insufficient_privilege; end if;
 select employee into sid from compi_private.lab_mail_outbox where recipient=addr
 and relay_key_hash=encode(sha256(convert_to(proof,'UTF8')),'hex') and expires_at>now();
 if sid is null then raise insufficient_privilege; end if;
 select * into s from public.compi_staff where id=sid for update;
 select * into b from compi_private.lab_mail_outbox where employee=sid for update;
 if s.invite_state is distinct from 'queued' or s.invite_until<=now() or b.message is null then return '{}'::jsonb; end if;
 if receipt is not null then
  if b.attempt is distinct from receipt then return '{}'::jsonb; end if;
  update compi_private.lab_mail_outbox set message=null,attempt=null,lease_until=null where employee=sid;
  update public.compi_staff set invite_state='delivered' where id=sid;
  return '{"delivered":true}'::jsonb;
 end if;
 if b.lease_until>now() then return '{}'::jsonb; end if;
 update compi_private.lab_mail_outbox set attempt=a,lease_until=now()+interval '30 seconds' where employee=sid;
 return jsonb_build_object('receipt',a,'message',b.message);
end $$;
revoke all on function public.compi_lab_relay(text,text,uuid) from public;
grant execute on function public.compi_lab_relay(text,text,uuid) to anon,authenticated;

-- The native Auth write and the hotel grant commit together. No password is sent to SQL.
create function public.compi_begin_accept(ticket text) returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid; s public.compi_staff%rowtype; t compi_private.lab_tickets%rowtype; a uuid:=gen_random_uuid(); u auth.users%rowtype;
begin
 if ticket !~ '^v7_[0-9a-f]{64}$' then raise insufficient_privilege; end if;
 select employee into sid from compi_private.lab_tickets where digest=sha256(convert_to(ticket,'UTF8'));
 select * into s from public.compi_staff where id=sid for update;
 select * into t from compi_private.lab_tickets where employee=sid for update;
 if t.digest is distinct from sha256(convert_to(ticket,'UTF8')) or s.id is null or s.invite_state not in ('queued','issued','delivered')
 or s.invite_until<=clock_timestamp() or s.user_id is not null or s.withdrawn_at is not null then raise insufficient_privilege; end if;
 if t.lease_until>now() then raise exception using errcode='PT409',message='Activación en curso'; end if;
 select * into u from auth.users where lower(email)=s.email;
 if u.id is not null and (u.email_confirmed_at is not null or (u.invited_at is null and u.raw_app_meta_data->>'compi_lab_staff' is distinct from sid::text) or exists(select 1 from public.compi_memberships where user_id=u.id)) then
  raise insufficient_privilege;
 end if;
 update compi_private.lab_tickets set attempt=a,lease_until=now()+interval '1 minute' where employee=sid;
 return jsonb_build_object('attempt',a,'email',s.email,'legacy_id',u.id,'employee',sid);
end $$;
revoke all on function public.compi_begin_accept(text) from public,anon,authenticated;
grant execute on function public.compi_begin_accept(text) to service_role;

create function compi_private.finish_lab_identity() returns trigger language plpgsql security definer set search_path='' as $$
declare sid uuid; s public.compi_staff%rowtype; a uuid; t compi_private.lab_tickets%rowtype;
begin
 if tg_op='UPDATE' and old.email_confirmed_at is not null then
  if old.raw_app_meta_data->>'compi_lab_attempt' is distinct from new.raw_app_meta_data->>'compi_lab_attempt' then raise exception 'La cuenta ya estaba activa'; end if;
  return new;
 end if;
 a:=(new.raw_app_meta_data->>'compi_lab_attempt')::uuid;
 select employee into sid from compi_private.lab_tickets where attempt=a;
 select * into s from public.compi_staff where id=sid for update;
 select * into t from compi_private.lab_tickets where employee=sid for update;
 if s.id is null or t.attempt is distinct from a or t.lease_until<=clock_timestamp()
 or s.email<>lower(new.email) or new.email_confirmed_at is null or s.user_id is not null or s.withdrawn_at is not null
 or s.invite_state not in ('queued','issued','delivered') or s.invite_until<=clock_timestamp()
 then raise exception 'La invitación dejó de estar disponible'; end if;
 update public.compi_staff set user_id=new.id,invite_state='accepted' where id=sid;
 insert into public.compi_memberships(user_id,hotel_key) values(new.id,s.hotel_key) on conflict do nothing;
 delete from compi_private.lab_tickets where employee=sid;
 update compi_private.lab_mail_outbox set message=null,attempt=null,lease_until=null where employee=sid;
 return new;
end $$;
revoke all on function compi_private.finish_lab_identity() from public,anon,authenticated;
create trigger compi_finish_test_invitation after insert or update of raw_app_meta_data,email_confirmed_at on auth.users
 for each row when (new.email_confirmed_at is not null and new.raw_app_meta_data ? 'compi_lab_attempt') execute function compi_private.finish_lab_identity();
;
