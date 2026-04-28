-- supabase/migrations/20260419_pending_bot_links_raw_tokens.sql
-- Short-lived raw-token storage bridging the webapp's token mint step
-- and the bot's /claim poll. Rows are deleted as soon as the bot claims.
create table if not exists public.pending_bot_links_raw_tokens (
  agent_token_id uuid primary key references public.agent_api_tokens(id) on delete cascade,
  raw_token text not null,
  created_at timestamptz not null default now()
);

-- Server-only table (accessed via service role); RLS with no policies
-- denies all anon/authenticated access.
alter table public.pending_bot_links_raw_tokens enable row level security;
