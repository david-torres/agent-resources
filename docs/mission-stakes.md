# Optional mission stakes

Source: ENCLAVE Aspirant V1, printed p. 97 (PDF page 102).

Difficulty and Danger each default to Conventional. The mission form keeps
these settings in a collapsed optional section; elevated settings open it on
edit. The whole group, including the Conduit, must agree before the mission.
High stakes are available to all characters, regardless of their economy.

A successful mission earns the usual 1 Merx plus 1 per Critical rating and
3 per Crisis rating. Double Crisis earns 7 Merx. Failure and pending earn
nothing. Completed mission counts and level progress are unchanged. Offscreen
missions keep their explicitly recorded Merx. Manual character totals remain
manual. Saving mission stakes refreshes attached automatic characters through
the existing progress service. Merging missions keeps the primary mission's
stakes, just as it keeps the primary outcome.

Apply `20261001000000_mission_stakes.sql` before deploying this code. It adds
validated, non-null Difficulty and Danger columns and defaults all existing
missions to Conventional, so existing rewards need no backfill.

For rollback, first return elevated missions to Conventional through the
application so automatic character rewards are refreshed, then roll back the
application and drop the two columns in a new migration. Dropping columns
without this step discards stakes and leaves stored rewards stale.
