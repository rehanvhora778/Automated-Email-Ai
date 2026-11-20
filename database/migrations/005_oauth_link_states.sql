-- =====================================================================
-- Migration 005: secure the Gmail-link OAuth round trip
--
-- Two problems this closes.
--
-- 1. The OAuth `state` parameter used to be the account id itself, passed
--    in on the query string by whoever called /actions/login-google. The
--    callback trusted it verbatim and wrote Google's tokens onto that
--    profile. Anyone could therefore aim a consent screen at an account
--    that was not theirs, in either direction: send a victim a link that
--    files THEIR mailbox under the ATTACKER's profile, or forge a plain
--    GET callback that files the attacker's mailbox under the VICTIM's.
--
--    `oauth_states` replaces that with an unguessable, single-use,
--    expiring value. The backend mints one per link attempt, Google hands
--    it back, and the exchanged token is parked on this row until the
--    browser that started the flow proves it is the same browser and the
--    same signed-in user. Only then does it reach `profiles`.
--
-- 2. `profiles.gmail_token` holds a long-lived Google refresh token, and
--    the browser was reading the whole column on every page load just to
--    decide whether to show a "Link Gmail" button. Column privileges stop
--    that: the anon/authenticated roles can still read their own profile,
--    minus the one column that is a credential. The backend uses the
--    service_role key, which is unaffected.
--
-- Idempotent / safe to re-run.
-- =====================================================================

-- ---------- 0. CATCH UP ANY MISSING COLUMN ----------
--
-- The grant below names every column the browser may read, which means
-- every one of them has to exist by the time it runs. `avatar_url` arrives
-- in migration 003, and a project that went straight from the original
-- schema to here has never seen it — Postgres then rejects the whole file
-- with `column "avatar_url" of relation "profiles" does not exist`, and
-- rolls back, so the table this migration is actually for is never created.
-- Adding it here costs nothing on a database that already has it and makes
-- this file safe to run against any state of the schema.

alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists signature  text;


-- ---------- 1. PENDING OAUTH LINK ATTEMPTS ----------

create table if not exists public.oauth_states (
    -- The random value handed to Google. Primary key, so a replayed
    -- callback cannot create a second row for the same attempt.
    state       text        primary key,
    user_id     uuid        not null references auth.users(id) on delete cascade,
    -- Filled in by the callback once Google's code has been exchanged, and
    -- cleared when the frontend confirms the link. A row carrying a token
    -- is an attempt waiting for that confirmation.
    token_data  jsonb,
    created_at  timestamptz not null default now(),
    expires_at  timestamptz not null
);

create index if not exists idx_oauth_states_expires
    on public.oauth_states (expires_at);

-- RLS on with no policies at all: anon and authenticated can do nothing
-- here, which is the intent. Only the backend's service_role key, which
-- bypasses RLS, ever touches this table. The explicit revoke covers the
-- blanket grant Supabase gives new tables in the public schema.
alter table public.oauth_states enable row level security;
revoke all on public.oauth_states from anon, authenticated;

-- Abandoned attempts (user closed the Google tab, never came back) have no
-- value once expired, and they hold a token — so they should not linger.
create or replace function public.purge_expired_oauth_states()
returns void
language sql
security definer
set search_path = public
as $$
    delete from public.oauth_states
    where expires_at < now();
$$;

revoke all on function public.purge_expired_oauth_states() from public, anon, authenticated;


-- ---------- 2. KEEP THE REFRESH TOKEN OUT OF THE BROWSER ----------
--
-- A table-level SELECT grant covers every column, including ones added
-- later, so the column list has to be granted explicitly after revoking
-- the table-level privilege. Row-level security is unchanged and still
-- restricts these to the signed-in user's own row.

revoke select on public.profiles from anon, authenticated;
grant select (id, full_name, avatar_url, signature, created_at)
    on public.profiles to anon, authenticated;

-- Likewise for writes: the app edits display fields from the browser, but
-- linking and unlinking Gmail now goes through the backend, which revokes
-- the grant at Google as well as clearing the row.
revoke update on public.profiles from anon, authenticated;
grant update (full_name, avatar_url, signature)
    on public.profiles to anon, authenticated;

notify pgrst, 'reload schema';
