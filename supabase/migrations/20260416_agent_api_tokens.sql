-- Long-lived personal access tokens for agent integrations.
-- Backfilled migration: the table was originally defined only in schema.sql,
-- which caused fresh local databases to miss it and broke later migrations
-- that FK to agent_api_tokens.id (e.g., 20260418_pending_bot_links.sql).
-- Idempotent so it's safe to run against databases where the table already exists.

create table if not exists public.agent_api_tokens (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    profile_id uuid not null references public.profiles(id) on delete cascade,
    name text not null,
    token_hash text not null unique,
    token_hint text not null,
    created_at timestamptz not null default now(),
    last_used_at timestamptz,
    revoked_at timestamptz
);

create index if not exists idx_agent_api_tokens_user_profile
    on public.agent_api_tokens(user_id, profile_id, created_at desc);

alter table public.agent_api_tokens enable row level security;

drop policy if exists "Users can manage own agent tokens" on public.agent_api_tokens;
create policy "Users can manage own agent tokens"
    on public.agent_api_tokens for all
    using (user_id = auth.uid() or is_admin())
    with check (user_id = auth.uid() or is_admin());
