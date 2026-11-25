-- Two-step verification by emailed code (sent with Resend by the API).
--
-- Before: rank-1 accounts needed a Supabase Auth MFA session (JWT aal = 'aal2').
-- Now: a session also counts as verified once its owner enters a 6-digit code
-- emailed to them. Codes and verified sessions live in Postgres, so this works
-- with any identity provider that puts `sub` and `session_id` in its tokens.
-- Everything else in compi_needs_mfa() (who needs it, the password-only
-- exception) is unchanged.

create table compi_private.second_factor_codes (
  session_id uuid primary key references auth.sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  digest bytea not null,
  expires_at timestamptz not null,
  attempts smallint not null default 0,
  sends smallint not null default 1,
  sent_at timestamptz not null default clock_timestamp()
);

create table compi_private.second_factor_sessions (
  session_id uuid primary key references auth.sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  verified_at timestamptz not null default clock_timestamp()
);

alter table compi_private.second_factor_codes enable row level security;
alter table compi_private.second_factor_sessions enable row level security;
revoke all on compi_private.second_factor_codes, compi_private.second_factor_sessions from public, anon, authenticated;

-- True when the current session passed a second factor (Supabase MFA or email code).
create function compi_private.second_factor_verified() returns boolean
  language sql stable security definer set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      or exists (
        select 1 from compi_private.second_factor_sessions v
        where v.session_id::text = auth.jwt() ->> 'session_id' and v.user_id = auth.uid()
      )
$$;

create or replace function public.compi_needs_mfa() returns boolean
  language sql stable security definer set search_path = ''
as $$
  select not compi_private.second_factor_verified() and exists (
    select 1
    from public.compi_staff s
    join public.compi_memberships m using (user_id, hotel_key)
    where s.user_id = auth.uid()
      and s.access_rank = 1
      and s.withdrawn_at is null
      and not exists (
        select 1 from compi_private.executive_password_only e
        where e.employee_id = s.id and e.user_id = s.user_id and e.hotel_key = s.hotel_key
          and s.hotel_key = 'hotel-arts-barcelona' and s.email = 'l.ribeiro.ejecutivo@compichef.com'
      )
  )
$$;

-- The current session's live auth session id, or an error.
create function compi_private.current_session_id() returns uuid
  language plpgsql stable security definer set search_path = ''
as $$
declare sid uuid;
begin
  begin
    sid := (auth.jwt() ->> 'session_id')::uuid;
  exception when invalid_text_representation then
    raise insufficient_privilege;
  end;
  if sid is null or auth.uid() is null or not exists (
    select 1 from auth.sessions s
    where s.id = sid and s.user_id = auth.uid() and (s.not_after is null or s.not_after > now())
  ) then
    raise exception using errcode = 'PT401', message = 'Vuelve a iniciar sesión.';
  end if;
  return sid;
end $$;

-- Issues a new code for the current session and returns it with the address to
-- send it to. SERVER ONLY: the API calls it with the verified token claims set
-- and its own role. Never granted to client roles, so the code can only reach
-- the user by email.
create function compi_private.second_factor_issue()
  returns table (email text, code text)
  language plpgsql volatile security definer set search_path = ''
as $$
declare
  sid uuid := compi_private.current_session_id();
  prior compi_private.second_factor_codes%rowtype;
  fresh text;
  draw bigint;
begin
  if not public.compi_needs_mfa() then
    raise exception using errcode = 'PT409', message = 'Esta sesión no necesita verificación.';
  end if;
  select * into prior from compi_private.second_factor_codes c where c.session_id = sid for update;
  if found and prior.sent_at > clock_timestamp() - interval '30 seconds' then
    raise exception using errcode = 'PT429', message = 'Espera un momento antes de volver a intentarlo.';
  end if;
  if found and prior.sends >= 5 then
    raise exception using errcode = 'PT429', message = 'Demasiados intentos. Vuelve a iniciar sesión.';
  end if;
  -- Uniform 6-digit code from a CSPRNG: rejection sampling over 32 random bits
  -- (4294000000 is the largest multiple of 10^6 below 2^32) avoids modulo bias.
  loop
    draw := ('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint;
    exit when draw < 4294000000;
  end loop;
  fresh := lpad((draw % 1000000)::text, 6, '0');
  insert into compi_private.second_factor_codes as c (session_id, user_id, digest, expires_at)
  values (sid, auth.uid(), extensions.digest(sid::text || ':' || fresh, 'sha256'), clock_timestamp() + interval '10 minutes')
  on conflict (session_id) do update
    set digest = excluded.digest, expires_at = excluded.expires_at, attempts = 0,
        sends = c.sends + 1, sent_at = clock_timestamp();
  return query select u.email::text, fresh from auth.users u where u.id = auth.uid();
end $$;

revoke all on function compi_private.second_factor_issue() from public, anon, authenticated;
revoke all on function compi_private.current_session_id() from public, anon, authenticated;
revoke all on function compi_private.second_factor_verified() from public, anon;
grant execute on function compi_private.second_factor_verified() to authenticated;

-- Checks a code for the current session. Returns 'verified', 'invalid',
-- 'expired' or 'locked' (5 wrong codes: request a new one). Wrong attempts are
-- recorded, so this returns instead of raising.
create function public.compi_second_factor_verify(code text) returns text
  language plpgsql volatile security definer set search_path = ''
as $$
declare
  sid uuid := compi_private.current_session_id();
  pending compi_private.second_factor_codes%rowtype;
begin
  select * into pending from compi_private.second_factor_codes c where c.session_id = sid for update;
  if not found or pending.expires_at <= clock_timestamp() then return 'expired'; end if;
  if pending.attempts >= 5 then return 'locked'; end if;
  if code !~ '^[0-9]{6}$'
     or extensions.digest(sid::text || ':' || code, 'sha256') <> pending.digest then
    update compi_private.second_factor_codes set attempts = attempts + 1 where session_id = sid;
    return case when pending.attempts + 1 >= 5 then 'locked' else 'invalid' end;
  end if;
  delete from compi_private.second_factor_codes where session_id = sid;
  insert into compi_private.second_factor_sessions (session_id, user_id) values (sid, auth.uid())
  on conflict (session_id) do nothing;
  return 'verified';
end $$;

revoke all on function public.compi_second_factor_verify(text) from public, anon;
grant execute on function public.compi_second_factor_verify(text) to authenticated, service_role;
