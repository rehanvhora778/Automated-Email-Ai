-- =====================================================================
-- Smart Email Agent — complete Supabase setup, in one file.
--
-- Use this when standing up a BRAND NEW Supabase project. It is
-- schema.sql plus every migration in `migrations/`, already applied in
-- the right order and with the historical data-backfill steps dropped
-- (there is no old data in a new project).
--
--   Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Safe to re-run. An EXISTING project should keep using schema.sql and
-- the numbered files in migrations/ instead, so the backfills still run.
--
-- After running this, finish the setup in the dashboard:
--   Authentication -> Sign In / Providers -> Google  -> enable, paste the
--     Google client ID + secret, and copy the callback URL it shows you
--     into Google Cloud Console -> Credentials -> Authorized redirect URIs.
--   Authentication -> URL Configuration -> Site URL  -> your Vercel URL
--   Authentication -> URL Configuration -> Redirect URLs -> add your Vercel
--     URL and http://localhost:5173 (and http://localhost:4173 for previews).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------

-- One profile per auth user. id == auth.users.id
-- `gmail_token` holds the Google OAuth token JSON from the Link Gmail flow.
create table if not exists public.profiles (
    id          uuid primary key references auth.users(id) on delete cascade,
    full_name   text,
    avatar_url  text,            -- from the Google profile picture
    signature   text,
    gmail_token jsonb,
    created_at  timestamptz not null default now()
);

-- Chat threads shown in the sidebar.
create table if not exists public.conversations (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users(id) on delete cascade,
    title      text not null default 'New conversation',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_conversations_user_updated
    on public.conversations (user_id, updated_at desc);

-- Individual chat messages, grouped into a conversation.
create table if not exists public.chat_messages (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references auth.users(id) on delete cascade,
    conversation_id uuid references public.conversations(id) on delete cascade,
    role            text not null,
    content         text,
    created_at      timestamptz not null default now()
);

create index if not exists idx_chat_messages_user_created
    on public.chat_messages (user_id, created_at desc);

create index if not exists idx_chat_messages_conversation
    on public.chat_messages (conversation_id, created_at);

-- Signup / password-reset codes this backend issues and checks itself,
-- rather than relying on Supabase's own mailer templates.
create table if not exists public.email_otps (
    id          uuid primary key default gen_random_uuid(),
    email       text        not null,
    purpose     text        not null check (purpose in ('signup', 'recovery')),
    -- Never the code itself: a leaked backup or a stray select would
    -- otherwise hand over live credentials. Verification re-hashes.
    code_hash   text        not null,
    expires_at  timestamptz not null,
    attempts    int         not null default 0,
    consumed_at timestamptz,
    created_at  timestamptz not null default now()
);

create index if not exists idx_email_otps_lookup
    on public.email_otps (email, purpose, created_at desc);

create index if not exists idx_email_otps_expires
    on public.email_otps (expires_at);

-- One row per in-flight "Link Gmail" attempt.
--
-- The OAuth `state` parameter must be unguessable and single-use, or a
-- forged callback can file one person's mailbox under another person's
-- account. The exchanged Google token waits here until the browser that
-- started the flow comes back and the signed-in user is confirmed to be
-- the one the attempt was minted for; only then is it written to profiles.
create table if not exists public.oauth_states (
    state       text        primary key,
    user_id     uuid        not null references auth.users(id) on delete cascade,
    token_data  jsonb,
    created_at  timestamptz not null default now(),
    expires_at  timestamptz not null
);

create index if not exists idx_oauth_states_expires
    on public.oauth_states (expires_at);


-- ---------------------------------------------------------------------
-- 2. AUTO-CREATE A PROFILE ON SIGNUP
--
-- Supabase copies the provider's metadata into raw_user_meta_data, but
-- under different keys per provider: the app's own signup sets
-- 'full_name', Google's ID token yields 'name' and 'picture'. Try each
-- in turn, then fall back to the local-part of the email.
-- ---------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, full_name, avatar_url)
    values (
        new.id,
        coalesce(
            nullif(new.raw_user_meta_data->>'full_name', ''),
            nullif(new.raw_user_meta_data->>'name', ''),
            split_part(new.email, '@', 1)
        ),
        coalesce(
            nullif(new.raw_user_meta_data->>'avatar_url', ''),
            nullif(new.raw_user_meta_data->>'picture', '')
        )
    )
    on conflict (id) do update
        set full_name  = coalesce(public.profiles.full_name, excluded.full_name),
            avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url);
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute procedure public.handle_new_user();


-- ---------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY
--
-- The backend uses the service_role key, which bypasses RLS entirely.
-- The frontend uses the anon/publishable key as the signed-in user, so
-- it needs to read its own rows — and nobody else's. These policies
-- grant exactly that.
-- ---------------------------------------------------------------------

alter table public.profiles      enable row level security;
alter table public.conversations enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
    for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "own conversations" on public.conversations;
create policy "own conversations" on public.conversations
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own messages" on public.chat_messages;
create policy "own messages" on public.chat_messages
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- email_otps and oauth_states get RLS on with NO policies at all, which is
-- the intent: anon and authenticated can do nothing. Only the backend's
-- service_role key touches them. Without this, the anon key could read
-- pending codes for any address and take over an account mid-signup, or
-- read a pending Google token out of a link attempt.
alter table public.email_otps   enable row level security;
alter table public.oauth_states enable row level security;
revoke all on public.email_otps   from anon, authenticated;
revoke all on public.oauth_states from anon, authenticated;

-- profiles.gmail_token holds a long-lived Google refresh token. The browser
-- never needs it — it asks the backend whether Gmail is linked — so it is
-- withheld at the column level. A table-level SELECT grant covers every
-- column, including ones added later, so the allowed columns have to be
-- granted back explicitly after revoking the table-level privilege. RLS
-- still restricts all of this to the signed-in user's own row, and the
-- backend's service_role key is unaffected.
revoke select on public.profiles from anon, authenticated;
grant select (id, full_name, avatar_url, signature, created_at)
    on public.profiles to anon, authenticated;

-- Linking and unlinking Gmail goes through the backend, which also revokes
-- the grant at Google. The browser only edits display fields.
revoke update on public.profiles from anon, authenticated;
grant update (full_name, avatar_url, signature)
    on public.profiles to anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. HOUSEKEEPING
--
-- Codes are single-use and short-lived, so rows have no value once past
-- expiry. Called opportunistically by the backend rather than on a
-- schedule, which keeps the table small without needing pg_cron.
-- ---------------------------------------------------------------------

create or replace function public.purge_expired_email_otps()
returns void
language sql
security definer
set search_path = public
as $$
    delete from public.email_otps
    where expires_at < now() - interval '1 day';
$$;

-- Abandoned link attempts (the user closed the Google tab and never came
-- back) hold a token, so they should not linger either.
create or replace function public.purge_expired_oauth_states()
returns void
language sql
security definer
set search_path = public
as $$
    delete from public.oauth_states
    where expires_at < now();
$$;

-- security definer functions are executable by everyone unless told
-- otherwise; these are housekeeping the backend calls, not an API.
revoke all on function public.purge_expired_email_otps()   from public, anon, authenticated;
revoke all on function public.purge_expired_oauth_states() from public, anon, authenticated;


-- Ask PostgREST to reload its schema cache so the API sees all of this now.
notify pgrst, 'reload schema';
