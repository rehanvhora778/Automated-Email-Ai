-- =====================================================================
-- Migration 003: Google (Gmail) sign-in
--
-- Sign-in moved from email/password to Google OAuth via Supabase. Google
-- populates raw_user_meta_data differently from the old signup flow, so the
-- profile trigger needs to understand that shape, and there is now an avatar
-- worth keeping.
--
-- Idempotent / safe to re-run.
-- =====================================================================

-- 1. Avatar from the Google profile.
alter table public.profiles
    add column if not exists avatar_url text;

-- 2. Teach the signup trigger to read Google's metadata.
--
--    The old version only looked for 'full_name', which the custom signup
--    endpoint set explicitly. Google's ID token instead yields 'name', and
--    Supabase copies through 'full_name', 'name', 'avatar_url' and 'picture'
--    depending on the provider, so try each in turn before falling back to the
--    local-part of the email.
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

-- 3. Backfill existing rows from the auth metadata that is already stored.
--    Users who signed up before this migration keep their name and gain an
--    avatar if Google supplied one.
update public.profiles p
set
    full_name = coalesce(
        p.full_name,
        nullif(u.raw_user_meta_data->>'full_name', ''),
        nullif(u.raw_user_meta_data->>'name', ''),
        split_part(u.email, '@', 1)
    ),
    avatar_url = coalesce(
        p.avatar_url,
        nullif(u.raw_user_meta_data->>'avatar_url', ''),
        nullif(u.raw_user_meta_data->>'picture', '')
    )
from auth.users u
where u.id = p.id
  and (p.full_name is null or p.avatar_url is null);

notify pgrst, 'reload schema';
