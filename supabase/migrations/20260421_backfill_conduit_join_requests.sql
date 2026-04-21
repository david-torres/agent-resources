-- supabase/migrations/20260421_backfill_conduit_join_requests.sql
-- Establishes the invariant that lfg_posts.host_id mirrors the approved conduit
-- lfg_join_requests row for each post. Before this change, two code paths wrote
-- conduit state independently:
--   1. "I will Conduit this game" on create set lfg_posts.host_id directly with
--      no join_request (orphaned host_id).
--   2. Joining as conduit + approving via the join-request flow left an approved
--      row but never updated host_id (orphaned approval).
--
-- Both orphans are reconciled below. Idempotent; safe to re-run.

-- 1a. For posts whose host already has a join_request that isn't the expected
--     approved-conduit shape (e.g. a stale rejected-player row from before the
--     host checkbox was used), promote it to approved conduit. The unique
--     (lfg_post_id, profile_id) constraint means we can't simply insert a new
--     row alongside a stale one.
update public.lfg_join_requests jr
   set join_type = 'conduit', character_id = null, status = 'approved'
  from public.lfg_posts lp
 where lp.host_id is not null
   and jr.lfg_post_id = lp.id
   and jr.profile_id = lp.host_id
   and (jr.join_type <> 'conduit' or jr.status <> 'approved');

-- 1b. For posts whose host has no join_request at all, insert an approved conduit row.
insert into public.lfg_join_requests (lfg_post_id, profile_id, join_type, character_id, status)
select lp.id, lp.host_id, 'conduit', null, 'approved'
  from public.lfg_posts lp
 where lp.host_id is not null
   and not exists (
     select 1 from public.lfg_join_requests jr
      where jr.lfg_post_id = lp.id
        and jr.profile_id = lp.host_id
   );

-- 2. For posts that already have an approved conduit join_request but stale
--    host_id, align host_id to the request's profile.
update public.lfg_posts lp
   set host_id = jr.profile_id
  from public.lfg_join_requests jr
 where jr.lfg_post_id = lp.id
   and jr.join_type = 'conduit'
   and jr.status = 'approved'
   and lp.host_id is distinct from jr.profile_id;
