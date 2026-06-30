-- =====================================================================
-- Smart Email Agent — Supabase schema
-- Run this once in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- Safe to re-run (uses IF NOT EXISTS / CREATE OR REPLACE).
-- =====================================================================

-- ---------- TABLES ----------

-- One profile per auth user. id == auth.users.id
create table if not exists public.profiles (
    id          uuid primary key references auth.users(id) on delete cascade,
    full_name   text,
    signature   text,
    gmail_token jsonb,
    created_at  timestamptz not null default now()
);

-- One resume per user (user_id is unique so re-upload overwrites)
create table if not exists public.resumes (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null unique references auth.users(id) on delete cascade,
    raw_text   text,
    file_path  text,
    created_at timestamptz not null default now()
);

-- Chat history
create table if not exists public.chat_messages (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users(id) on delete cascade,
    role       text not null,
    content    text,
    created_at timestamptz not null default now()
);

create index if not exists idx_chat_messages_user_created
    on public.chat_messages (user_id, created_at desc);

-- ---------- AUTO-CREATE PROFILE ON SIGNUP ----------
-- The frontend signs up with options.data.full_name, which lands in
-- raw_user_meta_data. This trigger creates the matching profiles row.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, full_name)
    values (
        new.id,
        coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute procedure public.handle_new_user();

-- ---------- ROW LEVEL SECURITY ----------
-- The backend uses the service_role key (bypasses RLS).
-- The frontend uses the anon/publishable key as the logged-in user, so it
-- needs to read its own rows. These policies grant exactly that.

alter table public.profiles      enable row level security;
alter table public.resumes       enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "own profile"  on public.profiles;
create policy "own profile" on public.profiles
    for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "own resumes" on public.resumes;
create policy "own resumes" on public.resumes
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own messages" on public.chat_messages;
create policy "own messages" on public.chat_messages
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- STORAGE BUCKET FOR RESUMES ----------
-- Backend uploads/downloads via service_role (bypasses storage RLS),
-- so a private bucket is enough.
insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;

-- Ask PostgREST to reload its schema cache so the API sees new tables now.
notify pgrst, 'reload schema';
