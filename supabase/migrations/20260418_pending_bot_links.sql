-- Bot linking codes for the Discord device-code flow.
-- Short-lived rows (10 min TTL) that tie a Discord user to an agent token
-- once the user confirms the code on the web side.
create table if not exists public.pending_bot_links (
  code text primary key,
  discord_user_id text not null,
  agent_token_id uuid references public.agent_api_tokens(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create index if not exists pending_bot_links_discord_user_id_idx
  on public.pending_bot_links (discord_user_id);

create index if not exists pending_bot_links_expires_at_idx
  on public.pending_bot_links (expires_at);

-- Server-only table (accessed via service role); RLS with no policies
-- denies all anon/authenticated access.
alter table public.pending_bot_links enable row level security;
