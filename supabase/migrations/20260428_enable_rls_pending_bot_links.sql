-- Enable RLS on pending_bot_links and pending_bot_links_raw_tokens.
-- Both tables are server-only (accessed exclusively via the service role),
-- so enabling RLS with no policies blocks all anon/authenticated access
-- while leaving server-side admin clients unaffected.
alter table public.pending_bot_links enable row level security;
alter table public.pending_bot_links_raw_tokens enable row level security;
