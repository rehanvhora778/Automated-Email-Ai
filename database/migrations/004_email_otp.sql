-- =====================================================================
-- Migration 004: first-party email OTP
--
-- Signup and password reset no longer rely on Supabase's own mailer. Its
-- templates send a confirmation *link* unless the project's template is edited
-- to include {{ .Token }}, and the code length is a project setting rather than
-- something the app can depend on. Both are dashboard state the code cannot see
-- or control, which made the six-box screens unreliable.
--
-- This table backs codes the backend issues and checks itself, over SMTP the
-- deployment configures. Supabase remains the identity store; only the delivery
-- and verification of the code moved.
--
-- Idempotent / safe to re-run.
-- =====================================================================

create table if not exists public.email_otps (
    id          uuid primary key default gen_random_uuid(),
    email       text        not null,
    purpose     text        not null check (purpose in ('signup', 'recovery')),
    -- Never the code itself: a leaked backup or a stray select would otherwise
    -- hand over live credentials. Verification re-hashes and compares.
    code_hash   text        not null,
    expires_at  timestamptz not null,
    attempts    int         not null default 0,
    consumed_at timestamptz,
    created_at  timestamptz not null default now()
);

-- Lookups are always "the newest live code for this address and purpose".
create index if not exists idx_email_otps_lookup
    on public.email_otps (email, purpose, created_at desc);

-- Sweeping expired rows should be cheap.
create index if not exists idx_email_otps_expires
    on public.email_otps (expires_at);

-- ---------- ACCESS ----------
-- RLS on with no policies at all: anon and authenticated can do nothing, which
-- is the intent. The backend uses the service_role key, which bypasses RLS.
-- Without this, the anon key could read pending codes for any address.
alter table public.email_otps enable row level security;

-- ---------- HOUSEKEEPING ----------
-- Codes are single-use and short-lived, so rows have no value once past expiry.
-- Called opportunistically by the backend rather than on a schedule, which
-- keeps the table small without needing pg_cron on the free tier.
create or replace function public.purge_expired_email_otps()
returns void
language sql
security definer
set search_path = public
as $$
    delete from public.email_otps
    where expires_at < now() - interval '1 day';
$$;

notify pgrst, 'reload schema';
