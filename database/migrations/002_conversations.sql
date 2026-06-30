-- =====================================================================
-- Migration 002: conversation threads
-- Adds a conversations table, links chat_messages to a conversation,
-- and migrates existing (ungrouped) messages into a "Previous chats" thread.
-- Idempotent / safe to re-run.
-- =====================================================================

-- 1. Conversations (chat threads)
create table if not exists public.conversations (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users(id) on delete cascade,
    title      text not null default 'New conversation',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_conversations_user_updated
    on public.conversations (user_id, updated_at desc);

alter table public.conversations enable row level security;
drop policy if exists "own conversations" on public.conversations;
create policy "own conversations" on public.conversations
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2. Link messages to a conversation
alter table public.chat_messages
    add column if not exists conversation_id uuid references public.conversations(id) on delete cascade;

create index if not exists idx_chat_messages_conversation
    on public.chat_messages (conversation_id, created_at);

-- 3. Migrate any existing ungrouped messages into one "Previous chats" thread per user
do $$
declare
    u record;
    new_conv uuid;
begin
    for u in (select distinct user_id from public.chat_messages where conversation_id is null) loop
        insert into public.conversations (user_id, title)
        values (u.user_id, 'Previous chats')
        returning id into new_conv;

        update public.chat_messages
        set conversation_id = new_conv
        where user_id = u.user_id and conversation_id is null;
    end loop;
end $$;

notify pgrst, 'reload schema';
