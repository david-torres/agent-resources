# Game Tables Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the URL-only `/party` tool with saved, shareable game tables. A table holds registered characters and unregistered guests (#176), can be opened from an LFG post, and stays in sync with that post's approved roster.

**Architecture:** Two new Postgres tables, `game_tables` and `game_table_members`, guarded by RLS: participants-only reads, plus column-level grants so users can never set the LFG link or join-request columns. A `GameTableService` (`services/game-tables/`) owns the rules. It loads a table with the service-role client, which is how anyone holding the link sees it, and computes what the viewer may do. User writes go through the viewer's own RLS client, so the database is the final authority. System writes (the LFG sync) use the service-role client. `routes/tables.js` serves:
- the table list
- each table page and its htmx member endpoints
- an unsaved draft at `/tables/new?c=…`, which takes over `/party`'s URL-built roster

**Tech Stack:** Express 4, express-handlebars, htmx (hx-boost on body), Alpine, Bulma, Supabase (PostgREST + RLS), bun:test, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-08-game-tables-design.md`, sections "2. Data model" (the two tables named above) and "4. Tables core". The member-state and conduit-notes tables belong to sub-projects 3 and 4. This plan is sub-project 2 of 5.

**Branch:** Stack on `stat-scaling`. The table page reuses the `stat-value` and `stat-scaling-row` partials and the fixed `App.initTooltips`. Create the worktree from `stat-scaling`'s head.

## Global Constraints

- A table seats at most **8** members, guests included. That is `PARTY_CAP`, exported from `util/party-stats.js`.
- A guest has a name (1–60 characters, trimmed, required), an optional class label (≤ 60), and the 12 `statList` stats. Each stat is a whole number from **0 to 5**; a missing stat counts as 0.
- A table name is 1–80 characters, trimmed.
- **Reads:** RLS SELECT is granted to participants only: the creator, the Conduit, and owners of seated characters. The anon role gets **no** privileges on either table. Link viewers, signed in or not, are served by the server through the service-role client, one table id at a time.
- **Writes:**

  | Action | Allowed |
  |---|---|
  | Seat a character | Any signed-in user may seat their **own** character, private included. The creator or Conduit may seat **public** characters. |
  | Add or edit a guest | Creator or Conduit |
  | Remove a member | Creator or Conduit, or the owner of the seated character |
  | Rename or delete a table | Creator (or admin) |

- **Conduit:**
  - A standalone table's `conduit_id` is its creator.
  - A table linked to an LFG post follows the post's `host_id`, falling back to the creator.
- **Column grants:**
  - `authenticated` may UPDATE only `game_tables.name`.
  - `authenticated` may INSERT only `table_id, character_id, guest_name, guest_class_label, guest_stats` into members, and UPDATE only the guest columns.
  - Only the service role writes `lfg_post_id`, `conduit_id` changes, or `lfg_join_request_id`.
- **Seating consent:** a seated private character's party columns are shown to everyone with the link. The server reads only `CHARACTER_COLUMNS` (Task 2) for seated characters, never the rest of the row.
- Members display in seating order (`created_at`). There is no reorder control in this sub-project.
- **Form errors:** validation and permission failures return through `sendRouteError` (`util/http-error.js`). On an htmx request that re-targets `#alerts` and shows a toast, which is this app's form-error pattern. No inline field errors.
- **Supabase inserts:** never chain `.select()` onto inserts into `game_tables` or `game_table_members` made through a user client. The SELECT policy's participant check can't see the row being inserted, so `RETURNING` fails with 42501. Generate table ids in the app (`crypto.randomUUID()`).
- **Tests:**
  - Run with `bun test <file>` for one file.
  - `bun run test:unit`, `bun run test:http` and `bun run test:integration` run the tiers. Integration needs local Supabase (`SUPABASE_URL=http://127.0.0.1:54321`); never point any test at production.
  - Known pre-existing red: `test/load-prerelease-classes.test.js` (unit), `routes/open-graph.test.js` (http). Compare failures by name, not count.
  - Several jsdom/Alpine view tests contaminate each other when run in one `bun test` call. Run them individually or through the tier script.
- **Migrations:** apply locally with `supabase migration up`, or `supabase db reset` followed by `bun run seed:local`. Production is applied by the user with `supabase db push --linked`. Never apply a migration to production yourself.
- **Commits:** only the files you touched (`git add <paths>`, never `git commit -a`). End messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Someone holding only the anon key tries to list tables** through PostgREST (`/rest/v1/game_tables`). They must get nothing, so a link stays a capability. *Pinned in Task 1 (`anon reads no tables`).*
2. **A user crafts a REST request** that sets `lfg_post_id` on their own table, or `lfg_join_request_id` on a member. That would pull another post's private characters into their table through the sync, so it must be denied. *Pinned in Task 1 (the column-grant tests).*
3. **The table is full when an LFG approval arrives.** The approval must still succeed; the character is simply not seated, and a later approval seats nobody beyond 8. *Pinned in Task 2 (`sync respects the cap`), and Task 5 makes sync failures non-fatal to the approval.*
4. **A seated character is deleted, or its owner withdraws from the post.** The seat disappears; manual seats and guests are never removed by the sync. *Pinned in Task 2 (`sync never touches manual seats or guests`). The FK cascades are in Task 1.*
5. **A malformed id or a deleted table in the URL** (`/tables/not-a-uuid`, a deleted table's id) renders the friendly 404, not a 500 or a hung request. *Pinned in Task 3. Every handler is wrapped in `asyncHandler`, because `routes/party.test.js` documents an earlier hang when one wasn't.*

---

### Task 1: Schema, RLS and grants

**Files:**
- Create: `supabase/migrations/20261009000000_game_tables.sql`
- Create: `models/game-tables-rls.integration.test.js`
- Modify: `scripts/run-tests.mjs` (add the new file to `integrationFiles`)

**Interfaces:**
- Produces:
  - Tables `public.game_tables` and `public.game_table_members` with the columns below.
  - SQL functions `public.can_manage_game_table(uuid)`, `public.is_game_table_participant(uuid)` and `public.owns_character(uuid)`, used by sub-project 3's policies too.

- [ ] **Step 1: Write the migration**

```sql
-- Game tables: a saved, shareable roster a group opens on game night
-- (docs/superpowers/specs/2026-10-08-game-tables-design.md). A member is a
-- registered character or a guest the table owns. Reads are participants
-- only; anyone else with the link is served by the server through the
-- service-role client, so the anon key can never enumerate tables. Column
-- grants keep the LFG link and join-request columns service-role only:
-- setting either is how the roster sync would pull characters in.

create table if not exists public.game_tables (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  conduit_id uuid references public.profiles(id) on delete set null,
  lfg_post_id uuid unique references public.lfg_posts(id) on delete set null,
  session_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.game_table_members (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.game_tables(id) on delete cascade,
  character_id uuid references public.characters(id) on delete cascade,
  lfg_join_request_id uuid unique references public.lfg_join_requests(id) on delete cascade,
  guest_name text,
  guest_class_label text,
  guest_stats jsonb,
  created_at timestamptz not null default now(),
  constraint game_table_members_character_or_guest check (
    (character_id is not null and guest_name is null and guest_class_label is null and guest_stats is null)
    or (character_id is null and guest_name is not null and guest_stats is not null and lfg_join_request_id is null)
  ),
  constraint game_table_members_guest_name_length
    check (guest_name is null or char_length(btrim(guest_name)) between 1 and 60),
  constraint game_table_members_guest_class_length
    check (guest_class_label is null or char_length(guest_class_label) <= 60),
  constraint game_table_members_guest_stats_object
    check (guest_stats is null or jsonb_typeof(guest_stats) = 'object'),
  constraint game_table_members_seat_once unique (table_id, character_id)
);

create index if not exists idx_game_table_members_table on public.game_table_members(table_id, created_at);
create index if not exists idx_game_table_members_character on public.game_table_members(character_id);

drop trigger if exists update_game_tables_updated_at on public.game_tables;
create trigger update_game_tables_updated_at
  before update on public.game_tables
  for each row
  execute function update_updated_at_column();

-- SECURITY DEFINER so the members policy can ask about game_tables (and the
-- reverse) without RLS recursion.
create or replace function public.can_manage_game_table(p_table_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from game_tables t
    join profiles p on p.id in (t.creator_id, t.conduit_id)
    where t.id = p_table_id and p.user_id = auth.uid()
  ) or is_admin();
$$;

create or replace function public.owns_character(p_character_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from characters c
    join profiles p on p.id = c.creator_id
    where c.id = p_character_id and p.user_id = auth.uid()
  );
$$;

create or replace function public.is_game_table_participant(p_table_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select can_manage_game_table(p_table_id) or exists (
    select 1
    from game_table_members m
    where m.table_id = p_table_id
      and m.character_id is not null
      and owns_character(m.character_id)
  );
$$;

alter table public.game_tables enable row level security;
alter table public.game_table_members enable row level security;

drop policy if exists "game_tables_participant_select" on public.game_tables;
create policy "game_tables_participant_select"
  on public.game_tables for select
  using (is_game_table_participant(id));

-- Users create standalone tables they run themselves; LFG-linked tables are
-- created by the service role.
drop policy if exists "game_tables_insert" on public.game_tables;
create policy "game_tables_insert"
  on public.game_tables for insert
  with check (
    exists (select 1 from profiles p where p.id = creator_id and p.user_id = auth.uid())
    and conduit_id = creator_id
    and lfg_post_id is null
  );

drop policy if exists "game_tables_creator_update" on public.game_tables;
create policy "game_tables_creator_update"
  on public.game_tables for update
  using (exists (select 1 from profiles p where p.id = creator_id and (p.user_id = auth.uid() or is_admin())))
  with check (exists (select 1 from profiles p where p.id = creator_id and (p.user_id = auth.uid() or is_admin())));

drop policy if exists "game_tables_creator_delete" on public.game_tables;
create policy "game_tables_creator_delete"
  on public.game_tables for delete
  using (exists (select 1 from profiles p where p.id = creator_id and (p.user_id = auth.uid() or is_admin())));

drop policy if exists "game_table_members_participant_select" on public.game_table_members;
create policy "game_table_members_participant_select"
  on public.game_table_members for select
  using (is_game_table_participant(table_id));

drop policy if exists "game_table_members_insert" on public.game_table_members;
create policy "game_table_members_insert"
  on public.game_table_members for insert
  with check (
    (character_id is null and can_manage_game_table(table_id))
    or (character_id is not null and (
      owns_character(character_id)
      or (can_manage_game_table(table_id)
          and exists (select 1 from characters c where c.id = character_id and c.is_public))
    ))
  );

drop policy if exists "game_table_members_guest_update" on public.game_table_members;
create policy "game_table_members_guest_update"
  on public.game_table_members for update
  using (character_id is null and can_manage_game_table(table_id))
  with check (character_id is null and can_manage_game_table(table_id));

drop policy if exists "game_table_members_delete" on public.game_table_members;
create policy "game_table_members_delete"
  on public.game_table_members for delete
  using (
    can_manage_game_table(table_id)
    or (character_id is not null and owns_character(character_id))
  );

-- Supabase's default privileges grant ALL on new public tables to anon and
-- authenticated. Revoke, then grant back exactly what the app uses.
revoke all on public.game_tables from anon, authenticated;
revoke all on public.game_table_members from anon, authenticated;

do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select, insert, delete on public.game_tables to authenticated';
    execute 'grant update (name) on public.game_tables to authenticated';
    execute 'grant select, delete on public.game_table_members to authenticated';
    execute 'grant insert (table_id, character_id, guest_name, guest_class_label, guest_stats) on public.game_table_members to authenticated';
    execute 'grant update (guest_name, guest_class_label, guest_stats) on public.game_table_members to authenticated';
  end if;
end
$do$;

-- /party became /tables; repoint the nav row that links it.
update public.nav_items set url = '/tables', label = 'Game Tables' where url = '/party';
```

- [ ] **Step 2: Apply it locally**

Run: `supabase migration up`
Expected: `Applying migration 20261009000000_game_tables.sql...` with no error. If the CLI reports the local database out of sync, run `supabase db reset && bun run seed:local` instead.

- [ ] **Step 3: Write the RLS integration tests**

`models/game-tables-rls.integration.test.js`:

```js
// The game tables' RLS and column grants (supabase/migrations/20261009000000_game_tables.sql).
// A table's link is a capability: only participants read through the API,
// and only the service role may set the columns the LFG roster sync trusts.
require('../util/require-local-supabase');
const { test, expect, afterAll } = require('bun:test');
const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const { supabaseAdmin, createUserClient } = require('./_base');
const { statList } = require('../util/enclave-consts');

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const db = new Client({ connectionString: process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };
const anonClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, clientOptions);

const created = { authUserIds: [], profileIds: [], characterIds: [], tableIds: [] };
let users;

const makeUser = async (tag) => {
  const email = `gt-rls-${tag}-${suffix}@example.test`;
  const password = `gt-rls-${tag}-${suffix}`;
  const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  created.authUserIds.push(data.user.id);
  const { data: profile, error: profileError } = await supabaseAdmin.from('profiles')
    .insert({ user_id: data.user.id, name: `GT ${tag} ${suffix}`, is_public: false, timezone: 'UTC' })
    .select().single();
  if (profileError) throw profileError;
  created.profileIds.push(profile.id);
  const signIn = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, clientOptions);
  const { data: session, error: signInError } = await signIn.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { profile, client: createUserClient(session.session.access_token) };
};

const makeCharacter = async (profileId, { isPublic }) => {
  const row = {
    creator_id: profileId, name: `GT char ${suffix}`, class: 'Test', level: 1,
    completed_missions: 0, commissary_reward: 0, is_public: isPublic,
    ...Object.fromEntries(statList.map((stat) => [stat, 1])),
  };
  const { data, error } = await supabaseAdmin.from('characters').insert(row).select('id').single();
  if (error) throw error;
  created.characterIds.push(data.id);
  return data.id;
};

// creator runs the table; player owns a private character; stranger owns a
// public one and is otherwise unrelated.
const setup = async () => {
  if (users) return users;
  await db.connect();
  const [creator, player, stranger] = await Promise.all([makeUser('creator'), makeUser('player'), makeUser('stranger')]);
  const playerPrivate = await makeCharacter(player.profile.id, { isPublic: false });
  const strangerPublic = await makeCharacter(stranger.profile.id, { isPublic: true });
  const tableId = crypto.randomUUID();
  const { error } = await creator.client.from('game_tables')
    .insert({ id: tableId, name: `GT table ${suffix}`, creator_id: creator.profile.id, conduit_id: creator.profile.id });
  if (error) throw error;
  created.tableIds.push(tableId);
  users = { creator, player, stranger, playerPrivate, strangerPublic, tableId };
  return users;
};

const membersOf = async (tableId) =>
  (await supabaseAdmin.from('game_table_members').select('*').eq('table_id', tableId)).data;

afterAll(async () => {
  if (created.tableIds.length) await supabaseAdmin.from('game_tables').delete().in('id', created.tableIds);
  if (created.characterIds.length) await supabaseAdmin.from('characters').delete().in('id', created.characterIds);
  for (const id of created.profileIds) await db.query('delete from profiles where id = $1', [id]);
  for (const id of created.authUserIds) await db.query('delete from auth.users where id = $1', [id]);
  await db.end();
});

test('anon reads no tables and cannot create one', async () => {
  const { creator } = await setup();
  const { data } = await anonClient.from('game_tables').select('id');
  expect(data || []).toEqual([]);
  const { error } = await anonClient.from('game_tables')
    .insert({ id: crypto.randomUUID(), name: 'x', creator_id: creator.profile.id, conduit_id: creator.profile.id });
  expect(error?.code).toBe('42501');
});

test('a stranger cannot read a table they have no part in; its creator can', async () => {
  const { creator, stranger, tableId } = await setup();
  expect((await stranger.client.from('game_tables').select('id').eq('id', tableId)).data).toEqual([]);
  expect((await creator.client.from('game_tables').select('id').eq('id', tableId)).data).toHaveLength(1);
});

test('users cannot create a table for someone else or pre-linked to an LFG post', async () => {
  const { creator, player } = await setup();
  const forOther = await creator.client.from('game_tables')
    .insert({ id: crypto.randomUUID(), name: 'x', creator_id: player.profile.id, conduit_id: player.profile.id });
  expect(forOther.error?.code).toBe('42501');
  const linked = await creator.client.from('game_tables').insert({
    id: crypto.randomUUID(), name: 'x', creator_id: creator.profile.id, conduit_id: creator.profile.id,
    lfg_post_id: crypto.randomUUID(),
  });
  expect(linked.error).not.toBeNull();
});

test('a player seats their own private character and becomes a participant', async () => {
  const { player, playerPrivate, tableId } = await setup();
  const { error } = await player.client.from('game_table_members').insert({ table_id: tableId, character_id: playerPrivate });
  expect(error).toBeNull();
  expect((await player.client.from('game_tables').select('id').eq('id', tableId)).data).toHaveLength(1);
});

test('the creator may seat a public character but not someone else\'s private one', async () => {
  const { creator, strangerPublic, tableId } = await setup();
  const otherPrivate = await makeCharacter(users.stranger.profile.id, { isPublic: false });
  expect((await creator.client.from('game_table_members').insert({ table_id: tableId, character_id: strangerPublic })).error).toBeNull();
  expect((await creator.client.from('game_table_members').insert({ table_id: tableId, character_id: otherPrivate })).error?.code).toBe('42501');
});

test('only the creator or Conduit adds and edits guests', async () => {
  const { creator, player, stranger, tableId } = await setup();
  const guest = { table_id: tableId, guest_name: `Guest ${suffix}`, guest_stats: { might: 2 } };
  expect((await stranger.client.from('game_table_members').insert(guest)).error?.code).toBe('42501');
  expect((await creator.client.from('game_table_members').insert(guest)).error).toBeNull();
  const row = (await membersOf(tableId)).find((m) => m.guest_name === guest.guest_name);
  await player.client.from('game_table_members').update({ guest_name: 'Renamed by player' }).eq('id', row.id);
  expect((await membersOf(tableId)).find((m) => m.id === row.id).guest_name).toBe(guest.guest_name);
});

test('a player removes their own seat but not a guest', async () => {
  const { creator, player, playerPrivate, tableId } = await setup();
  await creator.client.from('game_table_members').insert({ table_id: tableId, guest_name: `Keep ${suffix}`, guest_stats: {} });
  const rows = await membersOf(tableId);
  const keep = rows.find((m) => m.guest_name === `Keep ${suffix}`);
  await player.client.from('game_table_members').delete().eq('id', keep.id);
  expect((await membersOf(tableId)).some((m) => m.id === keep.id)).toBe(true);
  const own = rows.find((m) => m.character_id === playerPrivate);
  await player.client.from('game_table_members').delete().eq('id', own.id);
  expect((await membersOf(tableId)).some((m) => m.id === own.id)).toBe(false);
});

test('users cannot set the columns the LFG roster sync trusts', async () => {
  const { creator, strangerPublic, tableId } = await setup();
  const relink = await creator.client.from('game_tables').update({ lfg_post_id: crypto.randomUUID() }).eq('id', tableId);
  expect(relink.error?.code).toBe('42501');
  const forged = await creator.client.from('game_table_members')
    .insert({ table_id: tableId, character_id: strangerPublic, lfg_join_request_id: crypto.randomUUID() });
  expect(forged.error?.code).toBe('42501');
});

test('the creator renames the table; a participant who is not the creator cannot', async () => {
  const { creator, player, tableId } = await setup();
  await player.client.from('game_tables').update({ name: 'Player rename' }).eq('id', tableId);
  expect((await supabaseAdmin.from('game_tables').select('name').eq('id', tableId).single()).data.name).not.toBe('Player rename');
  expect((await creator.client.from('game_tables').update({ name: `Renamed ${suffix}` }).eq('id', tableId)).error).toBeNull();
  expect((await supabaseAdmin.from('game_tables').select('name').eq('id', tableId).single()).data.name).toBe(`Renamed ${suffix}`);
});
```

Add `'models/game-tables-rls.integration.test.js',` to the `integrationFiles` set in `scripts/run-tests.mjs`, next to `'models/nav-rls.integration.test.js'`.

- [ ] **Step 4: Run the tests**

Run: `bun test models/game-tables-rls.integration.test.js`
Expected: 9 pass. If `makeCharacter` fails on a NOT NULL column, add that column to `row`; the full list is in `supabase/migrations/20240101000000_baseline_schema.sql` (`characters`, ~lines 38–77).

To prove the tests can fail, temporarily comment out `revoke all … from anon, authenticated;` and run `supabase db reset`. The `anon reads no tables` and column-grant tests go red. Restore the line and reset again.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261009000000_game_tables.sql models/game-tables-rls.integration.test.js scripts/run-tests.mjs
git commit -m "feat: game tables schema with participant-only RLS (#176)"
```

---

### Task 2: Game table service

**Files:**
- Modify: `util/party-stats.js` (export `PARTY_CAP = 8`)
- Create: `services/game-tables/policy.js`
- Create: `services/game-tables/policy.test.js`
- Create: `services/game-tables/repository.js`
- Create: `services/game-tables/service.js`
- Create: `services/game-tables/service.test.js`
- Create: `models/game-tables.js`

**Interfaces:**
- Consumes: Task 1's tables. `summarizeParty` from `util/party-stats.js`. `FRIENDLY_NOT_FOUND` from `util/http-error.js`.
- Produces:
  - `PARTY_CAP` from `util/party-stats.js`.
  - From `services/game-tables/policy.js`:
    - `normalizeGuestInput(body) → { data } | { errors: string[] }`, where `data = { guest_name, guest_class_label, guest_stats }`
    - `normalizeTableName(raw) → { name } | { error }`
    - `toDisplayMember(row, profileId) → DisplayMember`
    - `capabilitiesFor(table, actor) → { signedIn, isCreator, canManage }`
  - `DisplayMember = { memberId, id, isGuest, ownerId, name, class, level, image_url, is_public, is_deceased, fromLfg, canViewDetails, ...12 stats }`. For a guest, `id` is the member id.
  - `GameTableService` methods. Each returns `{ data, error }`, where `error` is `{ status, code, title?, message }` or a PostgREST error:
    - `load(tableId, actor)` → `data: TableView = { table, members: DisplayMember[], summary, capabilities, isFull }`. Every member also carries `canRemove` and `canEdit`.
    - `listFor(client)` → rows `{ id, name, lfg_post_id, updated_at }`
    - `create(actor, { name, characterIds }, client)` → `data: { id }`
    - `rename(actor, tableId, name, client)`
    - `destroy(actor, tableId, client)`
    - `seatCharacter(actor, tableId, characterId, client)` → `data: TableView`
    - `addGuest(actor, tableId, body, client)` → `data: TableView`
    - `editGuest(actor, tableId, memberId, body, client)` → `data: TableView`
    - `guestFor(actor, tableId, memberId)` → `data: DisplayMember`
    - `removeMember(actor, tableId, memberId, client)` → `data: TableView`
    - `openForPost(actor, post)` → `data: { id }`
    - `syncLinkedTable(postId)` → `data: { id } | null`
  - `models/game-tables.js` exports `{ gameTables }`, the singleton built with the service-role client.

- [ ] **Step 1: Export the cap**

In `util/party-stats.js`, add above `summarizeParty`:

```js
// A party or game table seats at most this many: it keeps the breakdown
// table readable and a shared draft URL short.
const PARTY_CAP = 8;
```

Then change the export to `module.exports = { summarizeParty, PARTY_CAP };`. Task 4 deletes `routes/party.js`'s local copy.

- [ ] **Step 2: Write the failing policy tests**

`services/game-tables/policy.test.js`:

```js
// The pure rules behind a game table: guest validation and what a viewer may do.
const { test, expect } = require('bun:test');
const { normalizeGuestInput, normalizeTableName, toDisplayMember, capabilitiesFor } = require('./policy');
const { statList } = require('../../util/enclave-consts');

test('a guest needs a name; class is optional; missing stats are zero', () => {
  expect(normalizeGuestInput({ name: '  ' }).errors).toContain('Give the character a name.');
  const { data } = normalizeGuestInput({ name: ' Mira ', class_label: '', might: '2' });
  expect(data.guest_name).toBe('Mira');
  expect(data.guest_class_label).toBeNull();
  expect(data.guest_stats.might).toBe(2);
  expect(data.guest_stats.luck).toBe(0);
  expect(Object.keys(data.guest_stats).sort()).toEqual([...statList].sort());
});

test('guest stats are whole numbers from 0 to 5, and every bad one is named in stat order', () => {
  const { errors } = normalizeGuestInput({ name: 'Mira', might: '6', luck: '1.5', will: '-1' });
  const named = statList.filter((stat) => ['might', 'luck', 'will'].includes(stat)).join(', ');
  expect(errors).toEqual([`Stats must be whole numbers from 0 to 5: ${named}.`]);
});

test('guest names and class labels are capped at 60 characters', () => {
  expect(normalizeGuestInput({ name: 'x'.repeat(61) }).errors).toContain('Keep the name to 60 characters.');
  expect(normalizeGuestInput({ name: 'Mira', class_label: 'x'.repeat(61) }).errors).toContain('Keep the class to 60 characters.');
});

test('a table name is trimmed and 1–80 characters', () => {
  expect(normalizeTableName('  Friday game ')).toEqual({ name: 'Friday game' });
  expect(normalizeTableName('').error).toBe('Give the table a name.');
  expect(normalizeTableName('x'.repeat(81)).error).toBe('Keep the table name to 80 characters.');
});

test('a guest displays as a public, removable-by-manager member keyed by its member id', () => {
  const member = toDisplayMember({ id: 'm1', guest_name: 'Mira', guest_class_label: null, guest_stats: { might: 3 } }, 'p1');
  expect(member).toMatchObject({ memberId: 'm1', id: 'm1', isGuest: true, name: 'Mira', is_public: true, might: 3, luck: 0, canViewDetails: false });
});

test('a private seated character shows details only to its owner', () => {
  const row = { id: 'm2', lfg_join_request_id: 'r1', character: { id: 'c1', name: 'Ash', creator_id: 'owner', is_public: false, might: 1 } };
  expect(toDisplayMember(row, 'owner')).toMatchObject({ memberId: 'm2', id: 'c1', ownerId: 'owner', fromLfg: true, canViewDetails: true });
  expect(toDisplayMember(row, 'someone-else').canViewDetails).toBe(false);
});

test('capabilities follow creator, Conduit and admin', () => {
  const table = { creator_id: 'creator', conduit_id: 'conduit' };
  expect(capabilitiesFor(table, { profileId: 'creator' })).toEqual({ signedIn: true, isCreator: true, canManage: true });
  expect(capabilitiesFor(table, { profileId: 'conduit' })).toEqual({ signedIn: true, isCreator: false, canManage: true });
  expect(capabilitiesFor(table, { profileId: 'p', role: 'admin' })).toEqual({ signedIn: true, isCreator: true, canManage: true });
  expect(capabilitiesFor(table, { profileId: null })).toEqual({ signedIn: false, isCreator: false, canManage: false });
});
```

Run: `bun test services/game-tables/policy.test.js`
Expected: FAIL, `Cannot find module './policy'`.

- [ ] **Step 3: Write `services/game-tables/policy.js`**

```js
// Pure rules for game tables: input validation and what a viewer may do.
// capabilitiesFor mirrors the RLS in
// supabase/migrations/20261009000000_game_tables.sql so the page offers only
// what the database will accept; the database stays the final authority.
const { statList } = require('../../util/enclave-consts');

const TABLE_NAME_MAX = 80;
const GUEST_NAME_MAX = 60;
const GUEST_CLASS_MAX = 60;
const GUEST_STAT_MAX = 5;

const pickStats = (source = {}) =>
  Object.fromEntries(statList.map((stat) => [stat, Number(source?.[stat]) || 0]));

const normalizeTableName = (raw) => {
  const name = String(raw ?? '').trim();
  if (!name) return { error: 'Give the table a name.' };
  if (name.length > TABLE_NAME_MAX) return { error: `Keep the table name to ${TABLE_NAME_MAX} characters.` };
  return { name };
};

const normalizeGuestInput = (body = {}) => {
  const errors = [];
  const name = String(body.name ?? '').trim();
  if (!name) errors.push('Give the character a name.');
  else if (name.length > GUEST_NAME_MAX) errors.push(`Keep the name to ${GUEST_NAME_MAX} characters.`);

  const classLabel = String(body.class_label ?? '').trim();
  if (classLabel.length > GUEST_CLASS_MAX) errors.push(`Keep the class to ${GUEST_CLASS_MAX} characters.`);

  const stats = {};
  const badStats = [];
  for (const stat of statList) {
    const raw = body[stat];
    const value = raw === undefined || raw === '' ? 0 : Number(raw);
    if (Number.isInteger(value) && value >= 0 && value <= GUEST_STAT_MAX) stats[stat] = value;
    else badStats.push(stat);
  }
  if (badStats.length) errors.push(`Stats must be whole numbers from 0 to ${GUEST_STAT_MAX}: ${badStats.join(', ')}.`);

  if (errors.length) return { errors };
  return { data: { guest_name: name, guest_class_label: classLabel || null, guest_stats: stats } };
};

const toDisplayMember = (row, viewerProfileId) => {
  if (row.character) {
    const c = row.character;
    return {
      memberId: row.id,
      id: c.id,
      isGuest: false,
      ownerId: c.creator_id,
      name: c.name,
      class: c.class,
      level: c.level,
      image_url: c.image_url,
      is_public: c.is_public,
      is_deceased: c.is_deceased,
      fromLfg: Boolean(row.lfg_join_request_id),
      canViewDetails: c.is_public || (Boolean(viewerProfileId) && c.creator_id === viewerProfileId),
      ...pickStats(c),
    };
  }
  return {
    memberId: row.id,
    id: row.id,
    isGuest: true,
    ownerId: null,
    name: row.guest_name,
    class: row.guest_class_label,
    level: null,
    image_url: null,
    is_public: true,
    is_deceased: false,
    fromLfg: false,
    canViewDetails: false,
    ...pickStats(row.guest_stats),
  };
};

const capabilitiesFor = (table, actor) => {
  const profileId = actor?.profileId || null;
  const isAdmin = actor?.role === 'admin';
  const isCreator = isAdmin || (Boolean(profileId) && table.creator_id === profileId);
  const canManage = isCreator || (Boolean(profileId) && table.conduit_id === profileId);
  return { signedIn: Boolean(profileId), isCreator, canManage };
};

module.exports = { normalizeGuestInput, normalizeTableName, toDisplayMember, capabilitiesFor, TABLE_NAME_MAX };
```

Run: `bun test services/game-tables/policy.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 4: Write the failing service tests**

`services/game-tables/service.test.js`:

```js
// GameTableService: who may change a table, the cap, and the LFG roster sync.
// A fake repository records writes so each rule is checked without a database.
const { test, expect } = require('bun:test');
const { GameTableService } = require('./service');

const USER = { profileId: 'player' };
const CREATOR = { profileId: 'creator' };
const STRANGER = { profileId: 'stranger' };
const USER_CLIENT = { name: 'user-client' };
const SYSTEM = { name: 'system-client' };

// Members are shown in seating order (created_at); each fixture is seated
// after the one built before it.
let tick = 0;
const seatedAt = () => `2026-10-09T00:00:${String(++tick).padStart(2, '0')}Z`;
const seat = (id, characterId, ownerId, extra = {}) => ({
  id, character_id: characterId, lfg_join_request_id: null, created_at: seatedAt(),
  character: { id: characterId, name: characterId, creator_id: ownerId, is_public: true }, ...extra,
});
const guest = (id) => ({ id, character_id: null, lfg_join_request_id: null, created_at: seatedAt(), guest_name: id, guest_stats: {} });

const fakeRepo = (state) => {
  const calls = [];
  const record = (name) => async (...args) => { calls.push({ name, args }); return { data: null, error: null }; };
  return {
    calls,
    writes: () => calls.filter((c) => !['loadTable', 'getCharacterSeatInfo', 'findTableIdByPostId', 'findLinkedTable', 'getPostRoster', 'listTables'].includes(c.name)),
    loadTable: async (id) => { calls.push({ name: 'loadTable', args: [id] }); return { data: state.table ? { ...state.table, members: [...(state.members || [])] } : null, error: null }; },
    listTables: record('listTables'),
    insertTable: record('insertTable'),
    updateTable: record('updateTable'),
    deleteTable: record('deleteTable'),
    insertMembers: record('insertMembers'),
    updateMember: record('updateMember'),
    deleteMember: record('deleteMember'),
    deleteMembers: record('deleteMembers'),
    getCharacterSeatInfo: async (id) => ({ data: (state.characters || {})[id] || null, error: null }),
    findTableIdByPostId: async () => ({ data: state.linkedTableId || null, error: null }),
    findLinkedTable: async () => ({ data: state.linked || null, error: null }),
    getPostRoster: async () => ({ data: state.roster || null, error: null }),
  };
};

const service = (state) => {
  const repo = fakeRepo(state);
  return { repo, svc: new GameTableService(repo, { systemClient: SYSTEM, newId: () => 'new-id' }) };
};

const TABLE = { id: 't1', name: 'Friday', creator_id: 'creator', conduit_id: 'creator' };

test('a missing table is a 404', async () => {
  const { svc } = service({});
  expect((await svc.load('t1', USER)).error.status).toBe(404);
});

test('a player may remove only their own seat; the creator may remove any', async () => {
  const { svc } = service({ table: TABLE, members: [seat('m1', 'c1', 'player'), seat('m2', 'c2', 'other'), guest('g1')] });
  const asPlayer = (await svc.load('t1', USER)).data.members;
  expect(asPlayer.map((m) => m.canRemove)).toEqual([true, false, false]);
  const asCreator = (await svc.load('t1', CREATOR)).data.members;
  expect(asCreator.map((m) => m.canRemove)).toEqual([true, true, true]);
  expect(asCreator.map((m) => m.canEdit)).toEqual([false, false, true]);
});

test('anyone signed in may seat their own private character, through their own client', async () => {
  const { svc, repo } = service({ table: TABLE, members: [], characters: { c9: { id: 'c9', is_public: false, creator_id: 'player' } } });
  const { error } = await svc.seatCharacter(USER, 't1', 'c9', USER_CLIENT);
  expect(error).toBeUndefined();
  const insert = repo.calls.find((c) => c.name === 'insertMembers');
  expect(insert.args).toEqual([[{ table_id: 't1', character_id: 'c9' }], USER_CLIENT]);
});

test('the creator may seat public characters but not someone else\'s private one', async () => {
  const characters = { pub: { id: 'pub', is_public: true, creator_id: 'x' }, priv: { id: 'priv', is_public: false, creator_id: 'x' } };
  const { svc, repo } = service({ table: TABLE, members: [], characters });
  expect((await svc.seatCharacter(CREATOR, 't1', 'pub', USER_CLIENT)).error).toBeUndefined();
  expect((await svc.seatCharacter(CREATOR, 't1', 'priv', USER_CLIENT)).error.status).toBe(403);
  expect((await svc.seatCharacter(STRANGER, 't1', 'pub', USER_CLIENT)).error.status).toBe(403);
  expect(repo.calls.filter((c) => c.name === 'insertMembers')).toHaveLength(1);
});

test('a full table seats nobody else', async () => {
  const members = Array.from({ length: 8 }, (_, i) => guest(`g${i}`));
  const { svc, repo } = service({ table: TABLE, members, characters: { c9: { id: 'c9', is_public: false, creator_id: 'player' } } });
  expect((await svc.seatCharacter(USER, 't1', 'c9', USER_CLIENT)).error.status).toBe(400);
  expect((await svc.addGuest(CREATOR, 't1', { name: 'Mira' }, USER_CLIENT)).error.status).toBe(400);
  expect(repo.writes()).toEqual([]);
});

test('seating an already-seated character changes nothing', async () => {
  const { svc, repo } = service({ table: TABLE, members: [seat('m1', 'c1', 'player')], characters: { c1: { id: 'c1', is_public: true, creator_id: 'player' } } });
  expect((await svc.seatCharacter(USER, 't1', 'c1', USER_CLIENT)).data.members).toHaveLength(1);
  expect(repo.writes()).toEqual([]);
});

test('only the creator or Conduit adds guests, and bad input names its problem', async () => {
  const { svc, repo } = service({ table: TABLE, members: [] });
  expect((await svc.addGuest(USER, 't1', { name: 'Mira' }, USER_CLIENT)).error.status).toBe(403);
  const bad = await svc.addGuest(CREATOR, 't1', { name: '', might: '9' }, USER_CLIENT);
  expect(bad.error.status).toBe(400);
  expect(bad.error.message).toContain('Give the character a name.');
  expect(bad.error.message).toContain('might');
  await svc.addGuest(CREATOR, 't1', { name: 'Mira', might: '2' }, USER_CLIENT);
  const [rows] = repo.calls.find((c) => c.name === 'insertMembers').args;
  expect(rows[0]).toMatchObject({ table_id: 't1', guest_name: 'Mira', guest_class_label: null });
  expect(rows[0].guest_stats.might).toBe(2);
});

test('editing only applies to guests at this table', async () => {
  const { svc } = service({ table: TABLE, members: [seat('m1', 'c1', 'player')] });
  expect((await svc.editGuest(CREATOR, 't1', 'm1', { name: 'x' }, USER_CLIENT)).error.status).toBe(404);
});

test('a new table is run by its creator and seats at most eight distinct characters', async () => {
  const { svc, repo } = service({});
  const ids = ['a', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  const { data } = await svc.create(CREATOR, { name: ' Friday ', characterIds: ids }, USER_CLIENT);
  expect(data).toEqual({ id: 'new-id' });
  expect(repo.calls.find((c) => c.name === 'insertTable').args)
    .toEqual([{ id: 'new-id', name: 'Friday', creator_id: 'creator', conduit_id: 'creator' }, USER_CLIENT]);
  const [rows] = repo.calls.find((c) => c.name === 'insertMembers').args;
  expect(rows.map((r) => r.character_id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  expect((await svc.create(CREATOR, { name: '' }, USER_CLIENT)).error.status).toBe(400);
  expect((await svc.create({ profileId: null }, { name: 'x' }, USER_CLIENT)).error.status).toBe(403);
});

test('only the creator renames or deletes', async () => {
  const conduitTable = { ...TABLE, conduit_id: 'conduit' };
  const { svc } = service({ table: conduitTable, members: [] });
  expect((await svc.rename({ profileId: 'conduit' }, 't1', 'New', USER_CLIENT)).error.status).toBe(403);
  expect((await svc.destroy({ profileId: 'conduit' }, 't1', USER_CLIENT)).error.status).toBe(403);
  expect((await svc.rename(CREATOR, 't1', 'New', USER_CLIENT)).error).toBeUndefined();
});

const POST = { id: 'post1', title: 'Heist night', creator_id: 'creator', host_id: 'conduit' };

test('only the post\'s creator or Conduit opens its table; a second open reuses it', async () => {
  const { svc } = service({ linkedTableId: 'existing' });
  expect((await svc.openForPost(STRANGER, POST)).error.status).toBe(403);
  expect((await svc.openForPost({ profileId: 'conduit' }, POST)).data).toEqual({ id: 'existing' });
});

test('opening a new linked table names it after the post and makes the post\'s Conduit its Conduit', async () => {
  const { svc, repo } = service({});
  await svc.openForPost(CREATOR, POST);
  expect(repo.calls.find((c) => c.name === 'insertTable').args).toEqual([
    { id: 'new-id', name: 'Heist night', creator_id: 'creator', conduit_id: 'conduit', lfg_post_id: 'post1' }, SYSTEM,
  ]);
});

test('sync seats newly approved characters and unseats withdrawn ones, through the system client', async () => {
  const linked = { id: 't1', creator_id: 'creator', conduit_id: 'conduit', members: [
    { id: 'm-old', character_id: 'c-old', lfg_join_request_id: 'r-old' },
  ] };
  const roster = { host_id: 'conduit', approved: [{ id: 'r-new', character_id: 'c-new' }] };
  const { svc, repo } = service({ linked, roster });
  await svc.syncLinkedTable('post1');
  expect(repo.calls.find((c) => c.name === 'deleteMembers').args).toEqual([['m-old'], SYSTEM]);
  expect(repo.calls.find((c) => c.name === 'insertMembers').args)
    .toEqual([[{ table_id: 't1', character_id: 'c-new', lfg_join_request_id: 'r-new' }], SYSTEM]);
});

test('sync never touches manual seats or guests, and skips a character already seated by hand', async () => {
  const linked = { id: 't1', creator_id: 'creator', conduit_id: 'conduit', members: [
    { id: 'm-hand', character_id: 'c1', lfg_join_request_id: null },
    { id: 'g1', character_id: null, lfg_join_request_id: null },
  ] };
  const { svc, repo } = service({ linked, roster: { host_id: 'conduit', approved: [{ id: 'r1', character_id: 'c1' }] } });
  await svc.syncLinkedTable('post1');
  expect(repo.writes()).toEqual([]);
});

test('sync respects the cap', async () => {
  const members = Array.from({ length: 7 }, (_, i) => ({ id: `g${i}`, character_id: null, lfg_join_request_id: null }));
  const linked = { id: 't1', creator_id: 'creator', conduit_id: 'conduit', members };
  const roster = { host_id: 'conduit', approved: [{ id: 'r1', character_id: 'c1' }, { id: 'r2', character_id: 'c2' }] };
  const { svc, repo } = service({ linked, roster });
  await svc.syncLinkedTable('post1');
  const [rows] = repo.calls.find((c) => c.name === 'insertMembers').args;
  expect(rows.map((r) => r.character_id)).toEqual(['c1']);
});

test('sync follows the post\'s Conduit, falling back to the table creator', async () => {
  const linked = { id: 't1', creator_id: 'creator', conduit_id: 'conduit', members: [] };
  const { svc, repo } = service({ linked, roster: { host_id: null, approved: [] } });
  await svc.syncLinkedTable('post1');
  expect(repo.calls.find((c) => c.name === 'updateTable').args).toEqual(['t1', { conduit_id: 'creator' }, SYSTEM]);
});

test('sync does nothing for a post with no table', async () => {
  const { svc, repo } = service({});
  expect((await svc.syncLinkedTable('post1')).data).toBeNull();
  expect(repo.writes()).toEqual([]);
});
```

Run: `bun test services/game-tables/service.test.js`
Expected: FAIL, `Cannot find module './service'`.

- [ ] **Step 5: Write `services/game-tables/repository.js`**

```js
// Game table queries. Every function takes the client to run with: the
// caller's RLS client for user writes, the service-role client for reads
// served by link and for the LFG roster sync. Inserts never chain .select():
// the participant SELECT policy cannot see the row being inserted.
const { statList } = require('../../util/enclave-consts');

const withResult = async (query) => {
  const { data, error } = await query;
  if (error) {
    console.error(error);
    return { data: null, error };
  }
  return { data, error: null };
};

// The only character columns a table ever shows. Seating a private
// character consents to exactly these, nothing more.
const CHARACTER_COLUMNS = `id, name, image_url, class, class_id, level, is_deceased, is_public, creator_id, ${statList.join(', ')}`;

const TABLE_SELECT = `id, name, creator_id, conduit_id, lfg_post_id, session_started_at, created_at,
  creator:creator_id (id, name),
  conduit:conduit_id (id, name),
  members:game_table_members (id, character_id, lfg_join_request_id, guest_name, guest_class_label, guest_stats, created_at,
    character:character_id (${CHARACTER_COLUMNS}))`;

const getPostRoster = async (postId, client) => {
  const post = await withResult(client.from('lfg_posts').select('host_id').eq('id', postId).maybeSingle());
  if (post.error) return post;
  const requests = await withResult(client.from('lfg_join_requests')
    .select('id, character_id')
    .eq('lfg_post_id', postId)
    .eq('status', 'approved')
    .eq('join_type', 'player'));
  if (requests.error) return requests;
  return { data: { host_id: post.data?.host_id || null, approved: requests.data || [] }, error: null };
};

const findTableIdByPostId = async (postId, client) => {
  const result = await withResult(client.from('game_tables').select('id').eq('lfg_post_id', postId).maybeSingle());
  return { data: result.data?.id || null, error: result.error };
};

module.exports = {
  CHARACTER_COLUMNS,
  loadTable: (id, client) => withResult(client.from('game_tables').select(TABLE_SELECT).eq('id', id).maybeSingle()),
  listTables: (client) => withResult(client.from('game_tables')
    .select('id, name, lfg_post_id, updated_at')
    .order('updated_at', { ascending: false })),
  insertTable: (row, client) => withResult(client.from('game_tables').insert(row)),
  updateTable: (id, patch, client) => withResult(client.from('game_tables').update(patch).eq('id', id)),
  deleteTable: (id, client) => withResult(client.from('game_tables').delete().eq('id', id)),
  insertMembers: (rows, client) => withResult(client.from('game_table_members').insert(rows)),
  updateMember: (id, patch, client) => withResult(client.from('game_table_members').update(patch).eq('id', id)),
  deleteMember: (id, client) => withResult(client.from('game_table_members').delete().eq('id', id)),
  deleteMembers: (ids, client) => withResult(client.from('game_table_members').delete().in('id', ids)),
  getCharacterSeatInfo: (id, client) => withResult(client.from('characters')
    .select('id, is_public, creator_id').eq('id', id).maybeSingle()),
  findTableIdByPostId,
  findLinkedTable: (postId, client) => withResult(client.from('game_tables')
    .select('id, creator_id, conduit_id, members:game_table_members (id, character_id, lfg_join_request_id)')
    .eq('lfg_post_id', postId).maybeSingle()),
  getPostRoster,
};
```

- [ ] **Step 6: Write `services/game-tables/service.js`**

```js
// Every game table rule that is not pure validation (services/game-tables/policy.js):
// loading a table for any viewer, who may change it, the seat cap, and keeping an
// LFG-linked table in step with its post's approved roster.
//
// Tables are read with the service-role client because a link is a capability:
// anyone holding it may view, signed in or not. Each user write first checks
// permission here, then runs through the caller's own RLS client, so the
// database rejects anything this layer misses. Roster sync is system
// bookkeeping and writes with the service-role client.
const crypto = require('crypto');
const { summarizeParty, PARTY_CAP } = require('../../util/party-stats');
const { FRIENDLY_NOT_FOUND } = require('../../util/http-error');
const { normalizeGuestInput, normalizeTableName, toDisplayMember, capabilitiesFor, TABLE_NAME_MAX } = require('./policy');

const REQUIRED_REPOSITORY_METHODS = [
  'loadTable', 'listTables', 'insertTable', 'updateTable', 'deleteTable', 'insertMembers', 'updateMember',
  'deleteMember', 'deleteMembers', 'getCharacterSeatInfo', 'findTableIdByPostId', 'findLinkedTable', 'getPostRoster',
];

const notFound = () => ({ status: 404, code: 'not_found', message: FRIENDLY_NOT_FOUND });
const forbidden = (message) => ({ status: 403, code: 'forbidden', title: 'No access', message });
const invalid = (message) => ({ status: 400, code: 'invalid', title: 'Invalid submission', message });
const tableFull = () => invalid(`A table seats at most ${PARTY_CAP}.`);

class GameTableService {
  constructor(repository, { systemClient, newId = () => crypto.randomUUID() } = {}) {
    const missing = REQUIRED_REPOSITORY_METHODS.filter((method) => typeof repository?.[method] !== 'function');
    if (missing.length) throw new TypeError(`GameTableService requires repository methods: ${missing.join(', ')}`);
    this.repo = repository;
    this.system = systemClient;
    this.newId = newId;
  }

  async load(tableId, actor) {
    const { data: table, error } = await this.repo.loadTable(tableId, this.system);
    if (error) return { data: null, error };
    if (!table) return { data: null, error: notFound() };

    const capabilities = capabilitiesFor(table, actor);
    const profileId = actor?.profileId || null;
    const members = [...(table.members || [])]
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .map((row) => toDisplayMember(row, profileId))
      .map((member) => ({
        ...member,
        canRemove: capabilities.canManage || (Boolean(profileId) && member.ownerId === profileId),
        canEdit: capabilities.canManage && member.isGuest,
      }));

    return {
      data: { table, members, summary: summarizeParty(members), capabilities, isFull: members.length >= PARTY_CAP },
      error: undefined,
    };
  }

  listFor(client) {
    return this.repo.listTables(client);
  }

  async create(actor, { name, characterIds = [] } = {}, client) {
    if (!actor?.profileId) return { data: null, error: forbidden('Sign in to save a table.') };
    const named = normalizeTableName(name);
    if (named.error) return { data: null, error: invalid(named.error) };

    const id = this.newId();
    const inserted = await this.repo.insertTable(
      { id, name: named.name, creator_id: actor.profileId, conduit_id: actor.profileId }, client);
    if (inserted.error) return { data: null, error: inserted.error };

    const seats = [...new Set(characterIds)].slice(0, PARTY_CAP).map((characterId) => ({ table_id: id, character_id: characterId }));
    if (seats.length) {
      const seated = await this.repo.insertMembers(seats, client);
      if (seated.error) return { data: { id }, error: seated.error };
    }
    return { data: { id }, error: undefined };
  }

  async rename(actor, tableId, name, client) {
    const view = await this.load(tableId, actor);
    if (view.error) return view;
    if (!view.data.capabilities.isCreator) return { data: null, error: forbidden('Only the table\'s creator can rename it.') };
    const named = normalizeTableName(name);
    if (named.error) return { data: null, error: invalid(named.error) };
    const updated = await this.repo.updateTable(tableId, { name: named.name }, client);
    return { data: null, error: updated.error || undefined };
  }

  async destroy(actor, tableId, client) {
    const view = await this.load(tableId, actor);
    if (view.error) return view;
    if (!view.data.capabilities.isCreator) return { data: null, error: forbidden('Only the table\'s creator can delete it.') };
    const deleted = await this.repo.deleteTable(tableId, client);
    return { data: null, error: deleted.error || undefined };
  }

  async seatCharacter(actor, tableId, characterId, client) {
    const view = await this.load(tableId, actor);
    if (view.error) return view;
    const { capabilities, members, isFull } = view.data;
    if (!capabilities.signedIn) return { data: null, error: forbidden('Sign in to seat a character.') };
    if (members.some((member) => !member.isGuest && member.id === characterId)) return view;
    if (isFull) return { data: null, error: tableFull() };

    const { data: character, error } = await this.repo.getCharacterSeatInfo(characterId, this.system);
    if (error) return { data: null, error };
    if (!character) return { data: null, error: notFound() };
    const ownsIt = character.creator_id === actor.profileId;
    if (!ownsIt && !(capabilities.canManage && character.is_public)) {
      return { data: null, error: forbidden('You can seat your own characters; the table\'s creator or Conduit can also seat public ones.') };
    }

    const seated = await this.repo.insertMembers([{ table_id: tableId, character_id: characterId }], client);
    if (seated.error) return { data: null, error: seated.error };
    return this.load(tableId, actor);
  }

  async addGuest(actor, tableId, body, client) {
    const view = await this.load(tableId, actor);
    if (view.error) return view;
    if (!view.data.capabilities.canManage) return { data: null, error: forbidden('Only the table\'s creator or Conduit can add unregistered characters.') };
    if (view.data.isFull) return { data: null, error: tableFull() };
    const guest = normalizeGuestInput(body);
    if (guest.errors) return { data: null, error: invalid(guest.errors.join(' ')) };
    const inserted = await this.repo.insertMembers([{ table_id: tableId, ...guest.data }], client);
    if (inserted.error) return { data: null, error: inserted.error };
    return this.load(tableId, actor);
  }

  async guestFor(actor, tableId, memberId) {
    const view = await this.load(tableId, actor);
    if (view.error) return view;
    if (!view.data.capabilities.canManage) return { data: null, error: forbidden('Only the table\'s creator or Conduit can edit unregistered characters.') };
    const member = view.data.members.find((m) => m.memberId === memberId && m.isGuest);
    if (!member) return { data: null, error: notFound() };
    return { data: member, error: undefined };
  }

  async editGuest(actor, tableId, memberId, body, client) {
    const found = await this.guestFor(actor, tableId, memberId);
    if (found.error) return found;
    const guest = normalizeGuestInput(body);
    if (guest.errors) return { data: null, error: invalid(guest.errors.join(' ')) };
    const updated = await this.repo.updateMember(memberId, guest.data, client);
    if (updated.error) return { data: null, error: updated.error };
    return this.load(tableId, actor);
  }

  async removeMember(actor, tableId, memberId, client) {
    const view = await this.load(tableId, actor);
    if (view.error) return view;
    const member = view.data.members.find((m) => m.memberId === memberId);
    if (!member) return { data: null, error: notFound() };
    if (!member.canRemove) return { data: null, error: forbidden('You can remove your own characters; the table\'s creator or Conduit can remove anyone.') };
    const deleted = await this.repo.deleteMember(memberId, client);
    if (deleted.error) return { data: null, error: deleted.error };
    return this.load(tableId, actor);
  }

  async openForPost(actor, post) {
    const profileId = actor?.profileId || null;
    const runsPost = Boolean(profileId) && (post.creator_id === profileId || post.host_id === profileId);
    if (!runsPost && actor?.role !== 'admin') {
      return { data: null, error: forbidden('Only the post\'s creator or Conduit can open its table.') };
    }

    const existing = await this.repo.findTableIdByPostId(post.id, this.system);
    if (existing.error) return { data: null, error: existing.error };
    if (existing.data) return { data: { id: existing.data }, error: undefined };

    const id = this.newId();
    const name = String(post.title || '').trim().slice(0, TABLE_NAME_MAX) || 'Game night';
    const inserted = await this.repo.insertTable(
      { id, name, creator_id: profileId, conduit_id: post.host_id || profileId, lfg_post_id: post.id }, this.system);
    if (inserted.error) {
      // Two clicks raced; the unique lfg_post_id kept one table. Use it.
      if (inserted.error.code === '23505') {
        const winner = await this.repo.findTableIdByPostId(post.id, this.system);
        if (winner.data) return { data: { id: winner.data }, error: undefined };
      }
      return { data: null, error: inserted.error };
    }

    const synced = await this.syncLinkedTable(post.id);
    if (synced.error) return { data: { id }, error: synced.error };
    return { data: { id }, error: undefined };
  }

  // Seats approved player characters the table lacks (while seats remain) and
  // unseats any it seated for a request that is no longer approved. Seats it
  // did not make -- guests, characters seated by hand -- are never touched.
  async syncLinkedTable(postId) {
    const linked = await this.repo.findLinkedTable(postId, this.system);
    if (linked.error) return { data: null, error: linked.error };
    const table = linked.data;
    if (!table) return { data: null, error: undefined };

    const roster = await this.repo.getPostRoster(postId, this.system);
    if (roster.error) return { data: null, error: roster.error };
    const approved = (roster.data?.approved || []).filter((request) => request.character_id);
    const approvedIds = new Set(approved.map((request) => request.id));
    const members = table.members || [];

    const stale = members.filter((m) => m.lfg_join_request_id && !approvedIds.has(m.lfg_join_request_id)).map((m) => m.id);
    if (stale.length) {
      const removed = await this.repo.deleteMembers(stale, this.system);
      if (removed.error) return { data: null, error: removed.error };
    }

    const remaining = members.filter((m) => !stale.includes(m.id));
    const seatedRequestIds = new Set(remaining.map((m) => m.lfg_join_request_id).filter(Boolean));
    const seatedCharacterIds = new Set(remaining.map((m) => m.character_id).filter(Boolean));
    let room = PARTY_CAP - remaining.length;
    const toSeat = [];
    for (const request of approved) {
      if (room <= 0) break;
      if (seatedRequestIds.has(request.id) || seatedCharacterIds.has(request.character_id)) continue;
      toSeat.push({ table_id: table.id, character_id: request.character_id, lfg_join_request_id: request.id });
      seatedCharacterIds.add(request.character_id);
      room -= 1;
    }
    if (toSeat.length) {
      const seated = await this.repo.insertMembers(toSeat, this.system);
      if (seated.error) return { data: null, error: seated.error };
    }

    const conduitId = roster.data?.host_id || table.creator_id;
    if (conduitId !== table.conduit_id) {
      const updated = await this.repo.updateTable(table.id, { conduit_id: conduitId }, this.system);
      if (updated.error) return { data: null, error: updated.error };
    }
    return { data: { id: table.id }, error: undefined };
  }
}

module.exports = { GameTableService };
```

- [ ] **Step 7: Run the service tests**

Run: `bun test services/game-tables/service.test.js`
Expected: PASS, 17 tests. A test that expects `error` to be `undefined` relies on the service returning `error: undefined` on success, so keep that consistent.

- [ ] **Step 8: Wire the singleton**

`models/game-tables.js`:

```js
// The route-facing game table service, wired to the service-role client for
// link-served reads and LFG roster sync (see services/game-tables/service.js).
const { supabaseAdmin } = require('./_base');
const repository = require('../services/game-tables/repository');
const { GameTableService } = require('../services/game-tables/service');

const gameTables = new GameTableService(repository, { systemClient: supabaseAdmin });

module.exports = { gameTables };
```

- [ ] **Step 9: Check the repository's query shapes against local Supabase**

Run a throwaway script. Put it in your scratch directory and don't commit it. Run it with the worktree's `.env` loaded: `bun --env-file=.env <script>`.

```js
const { supabaseAdmin } = require('<worktree>/models/_base');
const repo = require('<worktree>/services/game-tables/repository');
(async () => {
  console.log(await repo.loadTable('00000000-0000-4000-8000-000000000000', supabaseAdmin));
  console.log(await repo.findLinkedTable('00000000-0000-4000-8000-000000000000', supabaseAdmin));
  console.log(await repo.getPostRoster('00000000-0000-4000-8000-000000000000', supabaseAdmin));
})();
```

Expected: each prints `{ data: null, error: null }` (or `data: { host_id: null, approved: [] }` for the roster), with no PostgREST relationship errors. An embed error such as `PGRST200`/`PGRST201` means a select string needs fixing. Fix it in `repository.js`.

- [ ] **Step 10: Run the unit tier and commit**

Run: `bun run test:unit`
Expected: only the known pre-existing red.

```bash
git add util/party-stats.js services/game-tables/ models/game-tables.js
git commit -m "feat: game table service with seat rules and LFG roster sync (#176)"
```

---

### Task 3: Saved table pages

**Files:**
- Create: `routes/tables.js`
- Create: `routes/tables.test.js`
- Modify: `scripts/run-tests.mjs` (add `'routes/tables.test.js'` to `httpFiles`)
- Modify: `app.js` (require and mount `/tables`)
- Create: `views/tables.handlebars`
- Create: `views/table.handlebars`
- Create: `views/partials/table-panel.handlebars`
- Create: `views/partials/table-panel-update.handlebars`
- Create: `views/partials/table-roster.handlebars`
- Create: `views/partials/table-search-results.handlebars`
- Create: `views/partials/table-guest-form.handlebars`

**Interfaces:**
- Consumes:
  - `gameTables` (Task 2).
  - `PARTY_CAP`.
  - `actorFromLocals` from `util/actor.js`.
  - `getOwnCharacters(profile, client) → { data }` and `searchPublicCharacters(q, count, options) → { data, error }` from `models/character.js`.
  - `authOptional` and `isAuthenticated` from `util/auth.js`.
  - `asyncHandler` from `util/async-handler.js`.
  - `sendError`, `sendRouteError` from `util/http-error.js`.
  - `isValidUuid` from `util/validate.js`.
- Produces:
  - Routes:
    - `GET /tables`
    - `POST /tables` (body `name`, `c`)
    - `GET /tables/s`
    - `GET /tables/:id`
    - `PUT /tables/:id` (body `name`)
    - `DELETE /tables/:id`
    - `POST /tables/:id/members` (body `character_id`)
    - `DELETE /tables/:id/members/:memberId`
    - `POST /tables/:id/guests`
    - `GET /tables/:id/guests/new`
    - `GET /tables/:id/members/:memberId/edit`
    - `PUT /tables/:id/members/:memberId`
  - Member endpoints answer with `partials/table-panel-update`: the `#table-panel` box, plus an out-of-band fresh guest form after a guest add or edit.
  - Panel context keys, which Task 4's draft also fills:
    - `draft`, `table`, `tableId`, `tableCsv`
    - `members`, `summary`, `capabilities`, `partyCap`
    - `droppedOverCap`, `unresolved`, `privateCount`
    - `profile`, `statList`
  - Task 4 adds `GET /tables/new` and `/tables/new/panel` to this router, above `/:id`.

- [ ] **Step 1: Write the route tests (failing)**

`routes/tables.test.js` copies the harness in `routes/party.test.js` (lines 1–176). Keep:
- the same env defaults;
- the same "capture the real modules, then `mock.module`" pattern for `../models/_base`, `../models/auth`, `../models/profile`, `../util/system-message`, `../models/lfg` and `../util/nav-loader`;
- the same `exphbs` engine and helper list. Add `statScaling` and `statScalingRow` from `../util/handlebars` to the helper list, because the table page renders `stat-value`.
- `startHttpServer`, and an `afterAll` that restores every mocked module.

Change these:
- Mock `../models/character` with `getOwnCharacters: async () => ({ data: [] })`, `searchPublicCharacters: async () => ({ data: [], error: null })` and `getPartyCharacters: async () => ({ data: [], error: null })`.
- Add a mock for `../models/game-tables` that returns `{ gameTables: fake }`. `fake` is an object whose methods tests replace per test.
- Mount `app.use('/tables', require('./tables'))` after clearing its require cache.
- Give `profile` the role `'user'`.

Then the tests:

```js
const TABLE_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = '22222222-2222-4222-8222-222222222222';
const view = (overrides = {}) => ({
  table: { id: TABLE_ID, name: 'Friday', creator_id: 'test-profile', conduit_id: 'test-profile', creator: { name: 'Dee' }, conduit: { name: 'Dee' } },
  members: [{ memberId: MEMBER_ID, id: MEMBER_ID, isGuest: true, name: 'Mira', class: 'Thane', is_public: true, canRemove: true, canEdit: true, canViewDetails: false, might: 1 }],
  summary: { totals: {}, gaps: [], strongest: [], weakest: [], breakdown: [], memberCount: 1 },
  capabilities: { signedIn: true, isCreator: true, canManage: true },
  isFull: false,
  ...overrides,
});
const authed = { Authorization: 'Bearer test-token', Accept: 'text/html' };
const hx = { ...authed, 'HX-Request': 'true' };

test('a table is viewable by link while signed out, with no edit controls', async () => {
  fake.load = async () => ({ data: view({ capabilities: { signedIn: false, isCreator: false, canManage: false } }) });
  const res = await get(`/tables/${TABLE_ID}`);
  const html = await res.text();
  expect(res.status).toBe(200);
  expect(html).toContain('Friday');
  expect(html).toContain('Mira');
  expect(html).not.toContain('data-guest-form');
  expect(html).not.toContain('hx-delete');
});

test('a malformed id and a missing table both render the friendly 404', async () => {
  fake.load = async () => ({ error: { status: 404, code: 'not_found', message: "We couldn't find that, or you don't have access to it." } });
  expect((await get('/tables/not-a-uuid')).status).toBe(404);
  expect((await get(`/tables/${TABLE_ID}`)).status).toBe(404);
});

test('a manager sees the guest form, and an unregistered member is marked as one', async () => {
  fake.load = async () => ({ data: view() });
  const html = await (await fetch(`${baseUrl}/tables/${TABLE_ID}`, { headers: authed })).text();
  expect(html).toContain('data-guest-form');
  expect(html).toContain('Unregistered');
});

test('adding a guest returns the new panel and a fresh guest form out of band', async () => {
  let received;
  fake.addGuest = async (actor, tableId, body) => { received = { actor, tableId, body }; return { data: view() }; };
  const res = await fetch(`${baseUrl}/tables/${TABLE_ID}/guests`, {
    method: 'POST', headers: { ...hx, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=Mira&might=1',
  });
  const html = await res.text();
  expect(res.status).toBe(200);
  expect(received.tableId).toBe(TABLE_ID);
  expect(received.body.name).toBe('Mira');
  expect(received.actor.profileId).toBe('test-profile');
  expect(html).toContain('id="table-panel"');
  expect(html).toContain('hx-swap-oob');
});

test('a rejected guest shows its reason as a toast', async () => {
  fake.addGuest = async () => ({ error: { status: 400, code: 'invalid', title: 'Invalid submission', message: 'Give the character a name.' } });
  const res = await fetch(`${baseUrl}/tables/${TABLE_ID}/guests`, {
    method: 'POST', headers: { ...hx, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=',
  });
  expect(res.status).toBe(400);
  expect(res.headers.get('HX-Retarget')).toBe('#alerts');
  expect(await res.text()).toContain('Give the character a name.');
});

test('seating requires sign-in and passes the viewer\'s own client', async () => {
  let receivedClient;
  fake.seatCharacter = async (actor, tableId, characterId, client) => { receivedClient = client; return { data: view() }; };
  const signedOut = await fetch(`${baseUrl}/tables/${TABLE_ID}/members`, {
    method: 'POST', headers: { 'HX-Request': 'true', 'Content-Type': 'application/x-www-form-urlencoded' }, body: `character_id=${MEMBER_ID}`,
  });
  expect(signedOut.headers.get('HX-Redirect')).toContain('/auth/check');
  const res = await fetch(`${baseUrl}/tables/${TABLE_ID}/members`, {
    method: 'POST', headers: { ...hx, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `character_id=${MEMBER_ID}`,
  });
  expect(res.status).toBe(200);
  expect(receivedClient).toBeDefined();
});

test('creating a table sends the browser to it', async () => {
  fake.create = async (actor, input) => ({ data: { id: TABLE_ID } });
  const res = await fetch(`${baseUrl}/tables`, {
    method: 'POST', headers: { ...hx, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=Friday&c=',
  });
  expect(res.headers.get('HX-Location')).toBe(`/tables/${TABLE_ID}`);
});

test('deleting a table returns to the list', async () => {
  fake.destroy = async () => ({ data: null });
  const res = await fetch(`${baseUrl}/tables/${TABLE_ID}`, { method: 'DELETE', headers: hx });
  expect(res.headers.get('HX-Location')).toBe('/tables');
});

test('the list shows the viewer\'s tables', async () => {
  fake.listFor = async () => ({ data: [{ id: TABLE_ID, name: 'Friday', lfg_post_id: null }] });
  const html = await (await fetch(`${baseUrl}/tables`, { headers: authed })).text();
  expect(html).toContain(`href="/tables/${TABLE_ID}"`);
});
```

Add `'routes/tables.test.js',` to `httpFiles` in `scripts/run-tests.mjs`.

Run: `bun test routes/tables.test.js`
Expected: FAIL, `Cannot find module './tables'`.

- [ ] **Step 2: Write the views**

`views/partials/table-search-results.handlebars`:

```handlebars
{{!-- Dense candidate rows with an Add button. On a saved table (tableId set)
      Add seats the character; on a draft it adds to #table-csv, the draft's
      only record of membership (see table-panel). --}}
{{#if characters.length}}
<div>
  {{#each characters}}
  <div class="is-flex is-justify-content-space-between is-align-items-center py-2 px-2">
    <span>
      <strong>{{this.name}}</strong>
      {{#if this.class}}<span class="has-text-grey is-size-7"> · {{this.class}}</span>{{/if}}
      {{#unless this.is_public}}
      <span class="icon is-small has-text-grey" title="Private"><i class="fas fa-lock"></i></span>
      {{/unless}}
      {{#if this.is_deceased}}
      <span class="icon is-small has-text-grey" title="Deceased"><i class="fas fa-skull"></i></span>
      {{/if}}
    </span>
    {{#if ../tableId}}
    <button type="button" class="button is-small is-primary"
      data-add-character="{{this.id}}"
      aria-label="Seat {{this.name}} at the table"
      hx-post="/tables/{{../tableId}}/members"
      hx-vals='{"character_id": "{{this.id}}"}'
      hx-target="#table-panel"
      hx-swap="outerHTML">Add</button>
    {{else}}
    <button type="button" class="button is-small is-primary"
      data-add-character="{{this.id}}"
      aria-label="Add {{this.name}} to the table"
      hx-get="/tables/new/panel"
      hx-vals='{"add": "{{this.id}}"}'
      hx-include="#table-csv"
      hx-target="#table-panel"
      hx-swap="outerHTML">Add</button>
    {{/if}}
  </div>
  {{/each}}
</div>
{{else}}
<div class="notification is-info is-light">
  {{#if q}}No characters found matching "{{q}}".{{else}}Type a name to search.{{/if}}
</div>
{{/if}}
```

`views/partials/table-roster.handlebars`:

```handlebars
{{!-- Seated members. Details lazy-loads the shared character-details
      fragment on first expand; it is offered only where that fragment will
      load for this viewer (public characters, or your own). Guests have no
      sheet, so they show their class label and an Edit control instead. --}}
{{#if members.length}}
<div class="table-roster">
  {{#each members}}
  <div class="box p-3 mb-2" data-member-id="{{this.memberId}}" x-data="{ open: false }">
    <div class="level is-mobile mb-0">
      <div class="level-left">
        <div class="level-item">
          <div>
            {{#if this.isGuest}}
            <strong>{{this.name}}</strong> <span class="tag is-light">Unregistered</span>
            {{else}}
            <a href="/characters/{{this.id}}/{{encodeURIComponentH this.name}}"><strong>{{this.name}}</strong></a>
            {{#unless this.is_public}}
            <span class="icon is-small" title="Private"><i class="fas fa-lock"></i></span>
            {{/unless}}
            {{#if this.is_deceased}}
            <span class="icon is-small" title="Deceased"><i class="fas fa-skull"></i></span>
            {{/if}}
            {{#if this.fromLfg}}<span class="tag is-light" title="Seated from the LFG post">LFG</span>{{/if}}
            {{/if}}
            <p class="help mb-0">{{this.class}}{{#if this.level}} · Level {{this.level}}{{/if}}</p>
          </div>
        </div>
      </div>
      <div class="level-right">
        {{#if this.canViewDetails}}
        <div class="level-item">
          <button type="button" class="button is-small is-info"
            @click="open = !open"
            hx-get="/characters/{{this.id}}/details"
            hx-trigger="click once"
            hx-target="#member-details-{{this.memberId}}"
            hx-swap="innerHTML">
            Details
          </button>
        </div>
        {{/if}}
        {{#if this.canEdit}}
        <div class="level-item">
          <button type="button" class="button is-small"
            hx-get="/tables/{{../tableId}}/members/{{this.memberId}}/edit"
            hx-target="#guest-form"
            hx-swap="innerHTML">Edit</button>
        </div>
        {{/if}}
        {{#if this.canRemove}}
        <div class="level-item">
          {{#if ../draft}}
          <button type="button" class="delete"
            data-remove-character="{{this.id}}"
            aria-label="Remove {{this.name}} from the table"
            hx-get="/tables/new/panel"
            hx-vals='{"remove": "{{this.id}}"}'
            hx-include="#table-csv"
            hx-target="#table-panel"
            hx-swap="outerHTML"></button>
          {{else}}
          <button type="button" class="delete"
            data-remove-member="{{this.memberId}}"
            aria-label="Remove {{this.name}} from the table"
            hx-delete="/tables/{{../tableId}}/members/{{this.memberId}}"
            hx-target="#table-panel"
            hx-swap="outerHTML"></button>
          {{/if}}
        </div>
        {{/if}}
      </div>
    </div>
    <div id="member-details-{{this.memberId}}" x-show="open" x-cloak class="mt-3"></div>
  </div>
  {{/each}}
</div>
{{else}}
<p class="has-text-grey">Nobody is seated yet.</p>
{{/if}}
```

`views/partials/table-panel.handlebars`:

```handlebars
{{!-- The roster and party stats. On a draft, #table-csv is the single source
      of truth for membership: every Add/Remove hx-includes it, because the
      Add buttons live in the left column, which does not re-render when this
      panel swaps. A saved table's membership lives in the database. --}}
<div id="table-panel" class="box">
  {{#if draft}}<input type="hidden" id="table-csv" name="c" value="{{tableCsv}}">{{/if}}

  <h3 class="title is-4">Roster <span class="tag is-light">{{summary.memberCount}}/{{partyCap}}</span></h3>

  {{#if droppedOverCap}}
  <div class="notification is-warning is-light">
    A table seats at most {{partyCap}}. {{droppedOverCap}} {{#if (eq droppedOverCap 1)}}character was{{else}}characters were{{/if}} left out.
  </div>
  {{/if}}

  {{#if unresolved}}
  <div class="notification is-warning is-light">
    {{unresolved}} {{#if (eq unresolved 1)}}character{{else}}characters{{/if}} could not be loaded. They may be private or no longer exist.
  </div>
  {{/if}}

  {{> table-roster members=members draft=draft tableId=tableId}}

  {{#if privateCount}}
  <div class="notification is-info is-light mt-3">
    <span class="icon"><i class="fas fa-lock"></i></span>
    {{privateCount}} {{#if (eq privateCount 1)}}member is private{{else}}members are private{{/if}}.
    Anyone you share this draft's link with will see a {{subtract summary.memberCount privateCount}}-member table. Save it as a table to share private members.
  </div>
  {{/if}}

  <hr>

  {{> party-summary summary=summary}}
</div>
```

`views/partials/table-panel-update.handlebars`:

```handlebars
{{!-- An htmx answer to a roster change: the panel, plus (after a guest is
      added or edited) a fresh guest form swapped out of band so the next
      guest starts from blank stats. --}}
{{> table-panel}}
{{#if resetGuestForm}}
<div id="guest-form" hx-swap-oob="innerHTML">{{> table-guest-form tableId=tableId statList=statList}}</div>
{{/if}}
```

`views/partials/table-guest-form.handlebars`:

```handlebars
{{!-- Add (or, given `guest`, edit) an unregistered character: a name, an
      optional class label, and the 12 stats as block selectors (0–5). Errors
      come back as a toast via sendRouteError. --}}
<form data-guest-form
  {{#if guest}}hx-put="/tables/{{tableId}}/members/{{guest.memberId}}"{{else}}hx-post="/tables/{{tableId}}/guests"{{/if}}
  hx-target="#table-panel" hx-swap="outerHTML">
  <h3 class="title is-5">{{#if guest}}Edit {{guest.name}}{{else}}Add an unregistered character{{/if}}</h3>
  <div class="field">
    <label class="label" for="guest-name">Name</label>
    <div class="control"><input class="input" id="guest-name" name="name" maxlength="60" required value="{{guest.name}}"></div>
  </div>
  <div class="field">
    <label class="label" for="guest-class">Class <span class="has-text-grey is-size-7">(optional)</span></label>
    <div class="control"><input class="input" id="guest-class" name="class_label" maxlength="60" value="{{guest.class}}"></div>
  </div>
  <div class="wizard-stat-grid">
    {{#each statList}}
    <div class="wizard-stat-row" data-stat="{{this}}">
      <div class="wizard-stat-name" tabindex="0" data-tooltip-markdown="">{{capitalize this}}</div>
      {{> stat-scaling-row stat=this}}
      {{> stat-blocks stat=this name=this value=(lookup ../guest this) max=5}}
    </div>
    {{/each}}
  </div>
  <div class="field is-grouped mt-3">
    <div class="control"><button class="button is-primary" type="submit">{{#if guest}}Save{{else}}Add to table{{/if}}</button></div>
    {{#if guest}}
    <div class="control">
      <button type="button" class="button" hx-get="/tables/{{tableId}}/guests/new" hx-target="#guest-form" hx-swap="innerHTML">Cancel</button>
    </div>
    {{/if}}
  </div>
</form>
```

`views/tables.handlebars`:

```handlebars
{{> breadcrumbs}}
<div class="level is-mobile">
  <div class="level-left"><h2 class="title is-2">Game Tables</h2></div>
  <div class="level-right">
    <a class="button is-primary" href="/tables/new"><span class="icon"><i class="fas fa-plus"></i></span><span>New table</span></a>
  </div>
</div>
<p class="subtitle is-6 has-text-grey">Tables you created, run as Conduit, or have a character seated at.</p>
{{#if tables.length}}
<div class="box">
  {{#each tables}}
  <a class="is-block py-2" href="/tables/{{this.id}}" data-table-id="{{this.id}}">
    <strong>{{this.name}}</strong>{{#if this.lfg_post_id}} <span class="tag is-light">LFG</span>{{/if}}
  </a>
  {{/each}}
</div>
{{else}}
<p class="has-text-grey">No tables yet. Start a <a href="/tables/new">new table</a>, or open one from an LFG post you're running.</p>
{{/if}}
```

`views/table.handlebars`. Its draft branches are filled in by Task 4; this task renders saved tables only.

```handlebars
{{> breadcrumbs}}
<div class="level is-mobile mb-2">
  <div class="level-left"><h2 class="title is-2 mb-0" data-table-name>{{table.name}}</h2></div>
  {{#if capabilities.isCreator}}
  <div class="level-right">
    <button type="button" class="button is-small is-danger is-light"
      hx-delete="/tables/{{table.id}}"
      hx-confirm="Delete this table? This cannot be undone.">Delete</button>
  </div>
  {{/if}}
</div>
<p class="subtitle is-6 has-text-grey">
  Created by {{table.creator.name}}{{#if table.conduit}} · Conduit: {{table.conduit.name}}{{/if}}.
  Anyone with this page's link can view it.
</p>
{{#if capabilities.isCreator}}
<details class="mb-4">
  <summary class="has-text-link">Rename</summary>
  <form class="field has-addons mt-2" hx-put="/tables/{{table.id}}">
    <div class="control is-expanded"><input class="input" name="name" maxlength="80" required value="{{table.name}}" aria-label="Table name"></div>
    <div class="control"><button class="button is-primary" type="submit">Save</button></div>
  </form>
</details>
{{/if}}

<div class="columns">
  {{#if profile}}
  <div class="column is-5">
    {{#if capabilities.canManage}}
    <div class="box">
      <h3 class="title is-5">Find Characters</h3>
      <div class="field">
        <div class="control has-icons-left">
          <input class="input" type="text" name="q" placeholder="Enter character name..."
            hx-get="/tables/s"
            hx-vals='{"tableId": "{{table.id}}"}'
            hx-trigger="keyup changed delay:500ms, search"
            hx-target="#table-search-results">
          <span class="icon is-left"><i class="fas fa-search"></i></span>
        </div>
      </div>
      <div id="table-search-results" class="mt-3">{{> table-search-results characters=null tableId=table.id}}</div>
    </div>
    {{/if}}

    <div class="box">
      <h3 class="title is-5">Seat One of Your Characters</h3>
      {{#if ownCharacters.length}}
      {{> table-search-results characters=ownCharacters tableId=table.id}}
      {{else}}
      <p class="has-text-grey">You have no characters yet.</p>
      {{/if}}
    </div>

    {{#if capabilities.canManage}}
    <div class="box" id="guest-form">{{> table-guest-form tableId=table.id statList=statList}}</div>
    {{/if}}
  </div>
  {{/if}}

  <div class="column {{#if profile}}is-7{{else}}is-12{{/if}}">
    {{> table-panel}}
  </div>
</div>
```

- [ ] **Step 3: Write `routes/tables.js`**

```js
// Game tables: a saved roster of registered and unregistered characters that
// anyone with the link can view (docs/superpowers/specs/2026-10-08-game-tables-design.md).
// Rules live in services/game-tables; this router maps requests onto them and
// renders. Member changes answer with the #table-panel fragment.
const express = require('express');
const { authOptional, isAuthenticated } = require('../util/auth');
const { asyncHandler } = require('../util/async-handler');
const { sendError, sendRouteError } = require('../util/http-error');
const { isValidUuid } = require('../util/validate');
const { actorFromLocals } = require('../util/actor');
const { statList } = require('../util/enclave-consts');
const { PARTY_CAP } = require('../util/party-stats');
const { getOwnCharacters, getPartyCharacters, searchPublicCharacters } = require('../models/character');
const { gameTables } = require('../models/game-tables');

const router = express.Router();

const ownCharactersFor = async (res) => {
  if (!res.locals.profile) return [];
  const { data } = await getOwnCharacters(res.locals.profile, res.locals.supabase);
  return data || [];
};

const panelContext = (view, profile) => ({
  draft: false,
  table: view.table,
  tableId: view.table.id,
  members: view.members,
  summary: view.summary,
  capabilities: view.capabilities,
  partyCap: PARTY_CAP,
  profile,
  statList,
});

const renderPanel = (res, view, { resetGuestForm = false } = {}) =>
  res.render('partials/table-panel-update', {
    layout: false, ...panelContext(view, res.locals.profile), resetGuestForm,
  });

const validIds = (req, res, ...names) => {
  if (names.every((name) => isValidUuid(req.params[name]))) return true;
  sendError(req, res, null);
  return false;
};

router.get('/', isAuthenticated, asyncHandler(async (req, res) => {
  const { data, error } = await gameTables.listFor(res.locals.supabase);
  if (error) return sendRouteError(req, res, error);
  res.render('tables', {
    profile: res.locals.profile,
    tables: data || [],
    activeNav: 'tables',
    breadcrumbs: [{ label: 'Game Tables', href: '/tables' }],
  });
}));

router.post('/', isAuthenticated, asyncHandler(async (req, res) => {
  // Only characters this viewer can see may be seated from a draft; RLS on
  // getPartyCharacters decides which those are.
  const requested = String(req.body.c || '').split(',').map((id) => id.trim()).filter(isValidUuid);
  const { data: visible, error: visibleError } = await getPartyCharacters(requested, res.locals.supabase);
  if (visibleError) return sendRouteError(req, res, visibleError);
  const visibleIds = new Set((visible || []).map((character) => character.id));

  const { data, error } = await gameTables.create(
    actorFromLocals(res.locals),
    { name: req.body.name, characterIds: requested.filter((id) => visibleIds.has(id)) },
    res.locals.supabase,
  );
  if (error && !data) return sendRouteError(req, res, error);
  res.header('HX-Location', `/tables/${data.id}`).send();
}));

router.get('/s', authOptional, asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const tableId = isValidUuid(String(req.query.tableId || '')) ? String(req.query.tableId) : null;
  if (q.length < 2) {
    return res.render('partials/table-search-results', { layout: false, characters: [], q, tableId });
  }
  const { data: characters, error } = await searchPublicCharacters(q, 12, {});
  if (error) return sendRouteError(req, res, error);
  res.render('partials/table-search-results', { layout: false, characters, q, tableId });
}));

router.get('/:id', authOptional, asyncHandler(async (req, res) => {
  if (!validIds(req, res, 'id')) return;
  const { data: view, error } = await gameTables.load(req.params.id, actorFromLocals(res.locals));
  if (error) return sendRouteError(req, res, error);
  res.render('table', {
    ...panelContext(view, res.locals.profile),
    ownCharacters: await ownCharactersFor(res),
    authOptional: true,
    activeNav: 'tables',
    breadcrumbs: [{ label: 'Game Tables', href: '/tables' }, { label: view.table.name, href: `/tables/${view.table.id}` }],
  });
}));

router.put('/:id', isAuthenticated, asyncHandler(async (req, res) => {
  if (!validIds(req, res, 'id')) return;
  const { error } = await gameTables.rename(actorFromLocals(res.locals), req.params.id, req.body.name, res.locals.supabase);
  if (error) return sendRouteError(req, res, error);
  res.header('HX-Refresh', 'true').send();
}));

router.delete('/:id', isAuthenticated, asyncHandler(async (req, res) => {
  if (!validIds(req, res, 'id')) return;
  const { error } = await gameTables.destroy(actorFromLocals(res.locals), req.params.id, res.locals.supabase);
  if (error) return sendRouteError(req, res, error);
  res.header('HX-Location', '/tables').send();
}));

router.post('/:id/members', isAuthenticated, asyncHandler(async (req, res) => {
  if (!validIds(req, res, 'id')) return;
  const characterId = String(req.body.character_id || '');
  if (!isValidUuid(characterId)) return sendError(req, res, null);
  const { data, error } = await gameTables.seatCharacter(actorFromLocals(res.locals), req.params.id, characterId, res.locals.supabase);
  if (error) return sendRouteError(req, res, error);
  renderPanel(res, data);
}));

router.delete('/:id/members/:memberId', isAuthenticated, asyncHandler(async (req, res) => {
  if (!validIds(req, res, 'id', 'memberId')) return;
  const { data, error } = await gameTables.removeMember(actorFromLocals(res.locals), req.params.id, req.params.memberId, res.locals.supabase);
  if (error) return sendRouteError(req, res, error);
  renderPanel(res, data);
}));

router.post('/:id/guests', isAuthenticated, asyncHandler(async (req, res) => {
  if (!validIds(req, res, 'id')) return;
  const { data, error } = await gameTables.addGuest(actorFromLocals(res.locals), req.params.id, req.body, res.locals.supabase);
  if (error) return sendRouteError(req, res, error);
  renderPanel(res, data, { resetGuestForm: true });
}));

router.get('/:id/guests/new', isAuthenticated, asyncHandler(async (req, res) => {
  if (!validIds(req, res, 'id')) return;
  res.render('partials/table-guest-form', { layout: false, tableId: req.params.id, statList });
}));

router.get('/:id/members/:memberId/edit', isAuthenticated, asyncHandler(async (req, res) => {
  if (!validIds(req, res, 'id', 'memberId')) return;
  const { data: guest, error } = await gameTables.guestFor(actorFromLocals(res.locals), req.params.id, req.params.memberId);
  if (error) return sendRouteError(req, res, error);
  res.render('partials/table-guest-form', { layout: false, tableId: req.params.id, guest, statList });
}));

router.put('/:id/members/:memberId', isAuthenticated, asyncHandler(async (req, res) => {
  if (!validIds(req, res, 'id', 'memberId')) return;
  const { data, error } = await gameTables.editGuest(actorFromLocals(res.locals), req.params.id, req.params.memberId, req.body, res.locals.supabase);
  if (error) return sendRouteError(req, res, error);
  renderPanel(res, data, { resetGuestForm: true });
}));

module.exports = router;
```

Mount it in `app.js` beside the party mount: `const tableRoutes = require('./routes/tables');` and `app.use('/tables', tableRoutes);`. Task 4 removes the party mount.

- [ ] **Step 4: Run the route tests**

Run: `bun test routes/tables.test.js`
Expected: PASS, 9 tests.
- If the 404 test sees 200 for `not-a-uuid`, check that `validIds` runs before `load`.
- If a page render throws "missing partial" or "missing helper", add it to the test harness's engine config, not to the template.

- [ ] **Step 5: Run the http and unit tiers**

Run: `bun run test:http` and `bun run test:unit`
Expected: only the known pre-existing reds.

- [ ] **Step 6: Commit**

```bash
git add routes/tables.js routes/tables.test.js scripts/run-tests.mjs app.js views/tables.handlebars views/table.handlebars views/partials/table-panel.handlebars views/partials/table-panel-update.handlebars views/partials/table-roster.handlebars views/partials/table-search-results.handlebars views/partials/table-guest-form.handlebars
git commit -m "feat: saved game table pages with unregistered characters (#176)"
```

---

### Task 4: Draft tables replace `/party`

**Files:**
- Create: `util/table-draft.js`
- Create: `util/table-draft.test.js`
- Modify: `routes/tables.js` (add `GET /new` and `GET /new/panel` above `GET /:id`)
- Modify: `routes/tables.test.js` (draft and redirect tests, ported from `routes/party.test.js`)
- Modify: `views/table.handlebars` (draft branches)
- Modify: `app.js` (replace the `/party` mount with a 301 to the draft)
- Modify: `views/lfg-post.handlebars:146` and `views/lfg-post.test.js:79-87` (link to the draft)
- Modify: `services/sitemap/build.js:27` (`'/party'` → `'/tables/new'`)
- Modify: `public/robots.txt:50` (`Disallow: /party/panel` → `Disallow: /tables/new/panel`)
- Modify: `scripts/run-tests.mjs` (remove `'routes/party.test.js'` from `httpFiles`)
- Delete: `routes/party.js`, `routes/party.test.js`, `views/party.handlebars`, `views/partials/party-panel.handlebars`, `views/partials/party-roster.handlebars`, `views/partials/party-search-results.handlebars`
- Delete and replace: `e2e/specs/17-virtual-party.spec.js` → `e2e/specs/17-game-tables.spec.js`

**Interfaces:**
- Consumes: Task 3's panel context keys, the `table-panel-update` partial and `PARTY_CAP`. `getPartyCharacters(ids, client)` from `models/character.js`.
- Produces:
  - `parseMembership(query) → { ids, droppedOverCap }`
  - `resolveDraft(query, client) → { members, summary, tableCsv, droppedOverCap, unresolved, privateCount } | { error }`. Draft members are display-shaped: `memberId = id`, `isGuest: false`, `canRemove: true`, `canViewDetails: true`.

- [ ] **Step 1: Port the membership tests (failing)**

Move the `parseMembership` and `resolveParty` tests from `routes/party.test.js` into `util/table-draft.test.js`, renaming `resolveParty` to `resolveDraft` and `partyCsv` to `tableCsv`. Keep every case: dedupe in first-seen order, add, remove, invalid ids dropped, cap at 8 with `droppedOverCap`, URL order preserved over the client's reversed rows, unresolved and private counts. Call `resolveDraft` with a stub client function in place of the module mock.

Add one new case:

```js
test('draft members are display-shaped for the shared roster', async () => {
  const rows = [{ id: uuid(1), name: 'Ash', is_public: true, might: 1 }];
  const draft = await resolveDraft({ c: uuid(1) }, null, async () => ({ data: rows, error: null }));
  expect(draft.members[0]).toMatchObject({ memberId: uuid(1), id: uuid(1), isGuest: false, canRemove: true, canViewDetails: true });
});
```

So that the test needn't mock modules, `resolveDraft`'s third parameter is the loader. It defaults to `getPartyCharacters`.

Run: `bun test util/table-draft.test.js`
Expected: FAIL, `Cannot find module './table-draft'`.

- [ ] **Step 2: Write `util/table-draft.js`**

```js
// An unsaved table lives entirely in its ?c= query string, so it works signed
// out and can be bookmarked before anyone saves it. Saving turns it into a
// game table (routes/tables.js POST /).
const { getPartyCharacters } = require('../models/character');
const { isValidUuid } = require('./validate');
const { summarizeParty, PARTY_CAP } = require('./party-stats');

const parseMembership = (query) => {
  const requested = String(query.c || '')
    .split(',')
    .map((id) => id.trim())
    .filter(isValidUuid);

  // Dedupe, preserving first-seen order: that order is the roster order.
  let ids = [...new Set(requested)];

  const add = String(query.add || '').trim();
  if (isValidUuid(add) && !ids.includes(add)) ids.push(add);

  const remove = String(query.remove || '').trim();
  if (isValidUuid(remove)) ids = ids.filter((id) => id !== remove);

  const droppedOverCap = Math.max(0, ids.length - PARTY_CAP);
  return { ids: ids.slice(0, PARTY_CAP), droppedOverCap };
};

// Anything RLS will not return simply does not come back -- that is the whole
// visibility mechanism for a draft (see getPartyCharacters).
const resolveDraft = async (query, client, loadCharacters = getPartyCharacters) => {
  const { ids, droppedOverCap } = parseMembership(query);

  const { data: rows, error } = await loadCharacters(ids, client);
  if (error) return { error };

  // .in() makes no ordering promise; impose the URL's order.
  const byId = new Map((rows || []).map((row) => [row.id, row]));
  const members = ids.map((id) => byId.get(id)).filter(Boolean).map((row) => ({
    ...row, memberId: row.id, isGuest: false, canRemove: true, canViewDetails: true,
  }));

  return {
    members,
    summary: summarizeParty(members),
    tableCsv: members.map((member) => member.id).join(','),
    droppedOverCap,
    unresolved: ids.length - members.length,
    privateCount: members.filter((member) => member.is_public === false).length,
  };
};

module.exports = { parseMembership, resolveDraft };
```

Run: `bun test util/table-draft.test.js`
Expected: PASS.

- [ ] **Step 3: Add the draft route tests (failing)**

Port the draft-relevant route tests from `routes/party.test.js` into `routes/tables.test.js` and retarget them:
- The page renders signed out.
- `#table-csv` carries membership across an add, using a `csvFrom(html)` that matches `id="table-csv"`.
- The panel sets `HX-Push-Url: /tables/new?c=…`.
- Search coerces an array `q`.
- The over-cap and unresolved notices render.
- A handler that throws does not hang the request.

Then add:

```js
test('/party sends old links to the draft, keeping the roster', async () => {
  const res = await fetch(`${baseUrl}/party?c=${uuid(1)},${uuid(2)}`, { redirect: 'manual' });
  expect(res.status).toBe(301);
  expect(res.headers.get('Location')).toBe(`/tables/new?c=${encodeURIComponent(`${uuid(1)},${uuid(2)}`)}`);
});

test('a signed-in draft offers to save, posting its roster', async () => {
  const html = await (await fetch(`${baseUrl}/tables/new?c=${uuid(1)}`, { headers: authed })).text();
  expect(html).toContain('hx-post="/tables"');
  expect(html).toContain('hx-include="#table-csv"');
});

test('a signed-out draft asks the visitor to sign in to save', async () => {
  const html = await (await get(`/tables/new?c=${uuid(1)}`)).text();
  expect(html).not.toContain('hx-post="/tables"');
  expect(html).toContain('Sign in');
});
```

The redirect test needs the same `/party` handler `app.js` installs. Export it from `routes/tables.js` as `router.partyRedirect`. Install it in the harness with `app.get('/party', tableRoutes.partyRedirect)`, and in `app.js` the same way.

Run: `bun test routes/tables.test.js`
Expected: FAIL on the new tests.

- [ ] **Step 4: Add the draft routes**

In `routes/tables.js`, require `{ resolveDraft }` from `../util/table-draft`, then add these above `router.get('/:id', …)`:

```js
const draftContext = (draft, profile) => ({ draft: true, ...draft, partyCap: PARTY_CAP, profile, statList });

router.get('/new', authOptional, asyncHandler(async (req, res) => {
  const draft = await resolveDraft(req.query, res.locals.supabase);
  if (draft.error) return sendRouteError(req, res, draft.error);
  res.render('table', {
    ...draftContext(draft, res.locals.profile),
    ownCharacters: await ownCharactersFor(res),
    authOptional: true,
    activeNav: 'tables',
    breadcrumbs: [{ label: 'New Table', href: '/tables/new' }],
  });
}));

router.get('/new/panel', authOptional, asyncHandler(async (req, res) => {
  const draft = await resolveDraft(req.query, res.locals.supabase);
  if (draft.error) return sendRouteError(req, res, draft.error);
  // The panel owns draft membership, so the address bar learns the new URL
  // from the response.
  res.header('HX-Push-Url', `/tables/new?c=${draft.tableCsv}`);
  res.render('partials/table-panel-update', { layout: false, ...draftContext(draft, res.locals.profile) });
}));
```

And before `module.exports`:

```js
// /party became the draft table; old links and bookmarks keep their roster.
router.partyRedirect = (req, res) => {
  const csv = String(req.query.c || '');
  res.redirect(301, csv ? `/tables/new?c=${encodeURIComponent(csv)}` : '/tables/new');
};
```

In `app.js`:
- remove `const partyRoutes = require('./routes/party');` and `app.use('/party', partyRoutes);`;
- add `app.get('/party', tableRoutes.partyRedirect);` next to the `/tables` mount.

- [ ] **Step 5: Add the draft branches to `views/table.handlebars`**

Replace the header block (everything above `<div class="columns">`) with:

```handlebars
{{> breadcrumbs}}
{{#if draft}}
<h2 class="title is-2">New Table</h2>
<p class="subtitle is-6 has-text-grey">
  Add characters to compare their stats. This draft lives in the page's address, so you can bookmark or share it.
  {{#if profile}}Save it to keep it, seat unregistered characters, and share private members.{{else}}<a href="/auth">Sign in</a> to save it as a table.{{/if}}
</p>
{{else}}
…the existing saved-table header (title, Delete, subtitle, Rename) unchanged…
{{/if}}
```

In the left column, replace `{{#if profile}}` with `{{#if (or draft profile)}}`, and `{{#if capabilities.canManage}}` around the search box with `{{#if (or draft capabilities.canManage)}}`. In the search input, the `hx-vals` attribute becomes `{{#unless draft}}hx-vals='{"tableId": "{{table.id}}"}'{{/unless}}`. In the search box and in the own-characters box, pass `tableId=table.id`; on a draft, `table` is undefined, so the Add buttons fall back to the draft mode. Wrap the own-characters box in `{{#if profile}}…{{/if}}`.

Add the save form at the top of the left column:

```handlebars
{{#if draft}}{{#if profile}}
<div class="box">
  <h3 class="title is-5">Save as a Table</h3>
  <form class="field has-addons" hx-post="/tables" hx-include="#table-csv">
    <div class="control is-expanded"><input class="input" name="name" maxlength="80" required placeholder="Friday game night" aria-label="Table name"></div>
    <div class="control"><button class="button is-primary" type="submit">Save</button></div>
  </form>
</div>
{{/if}}{{/if}}
```

The right column's width test becomes `{{#if (or draft profile)}}is-7{{else}}is-12{{/if}}`.

- [ ] **Step 6: Repoint the remaining `/party` references and delete the party files**

- `views/lfg-post.handlebars:146`: `href="/party?c={{partyCsv}}"` becomes `href="/tables/new?c={{partyCsv}}"`, and the label "Open in party tool" becomes "Open as a draft table". Task 5 replaces this whole button.
- `views/lfg-post.test.js:79-87`: assert `'/tables/new?c='` instead of `'/party?c='`.
- `services/sitemap/build.js:27`: `'/party'` → `'/tables/new'`. Update any sitemap test that pins the list.
- `public/robots.txt:50`: `Disallow: /tables/new/panel`.
- `scripts/run-tests.mjs`: remove `'routes/party.test.js',`.
- Delete with `git rm`: `routes/party.js`, `routes/party.test.js`, `views/party.handlebars`, `views/partials/party-panel.handlebars`, `views/partials/party-roster.handlebars`, `views/partials/party-search-results.handlebars`.
- Grep for leftovers: `grep -rn "party-panel\|party-roster\|party-search-results\|routes/party\|'/party" --exclude-dir=node_modules --exclude-dir=docs --exclude-dir=.git .`
  - Expected: only the `partyRedirect` code and tests, and comments that name `/party` historically. Fix those comments to describe the current code.
  - `party-summary` and `util/party-stats.js` stay; the table page and the LFG post page both use them.

- [ ] **Step 7: Rewrite the e2e spec**

`git mv e2e/specs/17-virtual-party.spec.js e2e/specs/17-game-tables.spec.js`, then retarget it:
- `page.goto('/tables/new')`.
- `#table-panel [data-member-id=…]` for the roster.
- `toHaveURL(/\/tables\/new\?c=/)` after an add.
- Keep its "membership survives across adds" assertions as they are.

Then add a second test in the same file. While signed in as the admin from global setup (follow how other specs sign in, through `storageState`):
1. Add a seeded character to a draft.
2. Fill the save form's name and click Save.
3. Expect the URL to match `/\/tables\/[0-9a-f-]{36}$/`.
4. Fill the guest form with name `Guest ${prefix}`, then click the third Might block (`[data-stat="might"] .stat-blocks [data-block="3"]`, or whatever block selector `views/partials/stat-blocks.handlebars` renders).
5. Submit, and expect `#table-panel` to contain the guest's name and the `Unregistered` tag.

Clean up by deleting tables whose name starts with the prefix in `afterAll`, through the `db` fixture: `delete from game_tables where name like $1`.

Run: `bunx playwright test e2e/specs/17-game-tables.spec.js --workers=1`
Expected: both tests pass.

- [ ] **Step 8: Run the tiers**

Run: `bun run test:unit`, `bun run test:http`, then `bun test routes/tables.test.js util/table-draft.test.js`
Expected: only the known pre-existing reds.

- [ ] **Step 9: Commit**

```bash
git add -A routes/ util/table-draft.js util/table-draft.test.js views/ app.js services/sitemap/build.js public/robots.txt scripts/run-tests.mjs e2e/specs/
git status --short   # confirm only this task's files are staged
git commit -m "feat: draft tables replace the /party tool (#176)"
```

---

### Task 5: Open a table from an LFG post

**Files:**
- Modify: `services/lfg/service.js` (constructor hooks; call `afterRosterChange` after each `syncConduitHostId` in `updateJoinRequest` and `leave`)
- Modify: `services/lfg/service.test.js`, or the existing LfgService test file (find it with `ls services/lfg/*.test.js`)
- Modify: `models/lfg.js:~151` (pass the hook)
- Modify: `routes/lfg.js` (add `POST /:id/table`; add `linkedTableId` and `canOpenTable` to `GET /:id`)
- Modify: `views/lfg-post.handlebars:140-152` (the Party Stats box's button)
- Modify: `views/lfg-post.test.js`
- Modify: `services/game-tables/service.js`, `services/game-tables/service.test.js` (`findTableIdForPost`)
- Test: `routes/lfg-table.test.js`, a new http-tier test added to `httpFiles`

**Interfaces:**
- Consumes: `gameTables.openForPost(actor, post)` and `gameTables.syncLinkedTable(postId)` from Task 2.
- Produces:
  - `new LfgService(repository, { afterRosterChange })`, where `afterRosterChange(postId)` is awaited after every roster-changing moderation.
  - `gameTables.findTableIdForPost(postId) → { data: id | null, error }`.

- [ ] **Step 1: Write the LfgService hook test (failing)**

In the LfgService test file, using its existing fake-repository helper:

```js
test('approving, rejecting or withdrawing a join request tells the roster hook which post changed', async () => {
  const changed = [];
  const service = new LfgService(fakeRepository(/* a request on post-1 whose creator is the actor */), {
    afterRosterChange: async (postId) => { changed.push(postId); },
  });
  await service.updateJoinRequest(hostActor, { requestId: 'req-1', status: 'approved' });
  await service.leave(hostActor, 'req-1');
  expect(changed).toEqual(['post-1', 'post-1']);
});

test('a failing roster hook does not fail the moderation', async () => {
  const service = new LfgService(fakeRepository(/* same */), {
    afterRosterChange: async () => { throw new Error('table sync down'); },
  });
  const result = await service.updateJoinRequest(hostActor, { requestId: 'req-1', status: 'approved' });
  expect(result.error).toBeFalsy();
});
```

Adapt `fakeRepository`, `hostActor` and the ids to the file's existing fixtures. The assertions stay.

Run the file. Expected: FAIL. The hook is never called.

- [ ] **Step 2: Add the hook to LfgService**

In `services/lfg/service.js`, change the constructor signature to `constructor(repository, { afterRosterChange } = {})` and store `this.afterRosterChange = afterRosterChange || null;`. Add this method below `syncConduitHostId`:

```js
  // Lets dependents that mirror a post's approved roster (a linked game
  // table) catch up. Never fails the moderation that triggered it.
  async notifyRosterChange(postId) {
    if (!this.afterRosterChange || !postId) return;
    try {
      await this.afterRosterChange(postId);
    } catch (err) {
      console.error(err);
    }
  }
```

Call `await this.notifyRosterChange(resolvedPostId);` right after `await this.syncConduitHostId(resolvedPostId);` in `updateJoinRequest`. In `leave`, call `await this.notifyRosterChange(request.lfg_post_id);` inside the same `if` as its `syncConduitHostId` call.

In `models/lfg.js`:

```js
const { gameTables } = require('./game-tables');
…
const lfgService = new LfgService(lfgRepository, {
  afterRosterChange: async (postId) => {
    const { error } = await gameTables.syncLinkedTable(postId);
    if (error) console.error(error);
  },
});
```

Run the LfgService tests. Expected: PASS. Then run `bun run test:unit`. Any test that mocks `../models/game-tables` indirectly through `models/lfg` must still load; if `models/lfg.js` now fails to require in an existing test harness, add `../models/game-tables` to that harness's mocks.

- [ ] **Step 3: Expose a by-post lookup on the service**

Add to `GameTableService`:

```js
  findTableIdForPost(postId) {
    return this.repo.findTableIdByPostId(postId, this.system);
  }
```

Add a test to `services/game-tables/service.test.js`:

```js
test('a post\'s table is found through the system client', async () => {
  const { svc } = service({ linkedTableId: 't9' });
  expect((await svc.findTableIdForPost('post1')).data).toBe('t9');
});
```

- [ ] **Step 4: Write the route and view tests (failing)**

`routes/lfg-table.test.js` uses the http harness from `routes/lfg-log-game.test.js`; copy its setup and mocks. Add a mock of `../models/game-tables`: `{ gameTables: { openForPost, findTableIdForPost } }`. Then:

```js
test('the post\'s creator opens its table and is sent there', async () => {
  gameTablesFake.openForPost = async (actor, post) => ({ data: { id: TABLE_ID } });
  const res = await fetch(`${baseUrl}/lfg/${POST_ID}/table`, { method: 'POST', headers: hxAuthed });
  expect(res.headers.get('HX-Location')).toBe(`/tables/${TABLE_ID}`);
});

test('anyone else gets the service\'s refusal as a toast', async () => {
  gameTablesFake.openForPost = async () => ({ error: { status: 403, code: 'forbidden', title: 'No access', message: 'Only the post\'s creator or Conduit can open its table.' } });
  const res = await fetch(`${baseUrl}/lfg/${POST_ID}/table`, { method: 'POST', headers: hxAuthed });
  expect(res.status).toBe(403);
  expect(res.headers.get('HX-Retarget')).toBe('#alerts');
});

test('a post with a table links to it for every viewer', async () => {
  gameTablesFake.findTableIdForPost = async () => ({ data: TABLE_ID });
  const html = await (await fetch(`${baseUrl}/lfg/${POST_ID}`, { headers: { Accept: 'text/html' } })).text();
  expect(html).toContain(`href="/tables/${TABLE_ID}"`);
});

test('without a table, the creator sees Open table and others see the draft link', async () => {
  gameTablesFake.findTableIdForPost = async () => ({ data: null });
  const asCreator = await (await fetch(`${baseUrl}/lfg/${POST_ID}`, { headers: authed })).text();
  expect(asCreator).toContain(`hx-post="/lfg/${POST_ID}/table"`);
  const asVisitor = await (await fetch(`${baseUrl}/lfg/${POST_ID}`, { headers: { Accept: 'text/html' } })).text();
  expect(asVisitor).not.toContain(`hx-post="/lfg/${POST_ID}/table"`);
  expect(asVisitor).toContain('/tables/new?c=');
});
```

The post fixture needs at least one approved member with a character, so that `approvedCount > 0`. Its `creator_id` must equal the mocked profile id for the "creator" request.

Add `'routes/lfg-table.test.js',` to `httpFiles`.

Run: `bun test routes/lfg-table.test.js`
Expected: FAIL.

- [ ] **Step 5: Implement the route and the view**

In `routes/lfg.js`, require `{ gameTables }` from `../models/game-tables`. In `GET /:id`, before `res.render`:

```js
  const { data: linkedTableId } = await gameTables.findTableIdForPost(data.id);
  const canOpenTable = Boolean(profile) && (data.creator_id === profile.id || data.host_id === profile.id);
```

Pass `linkedTableId` and `canOpenTable` to the render. Add the route:

```js
router.post('/:id/table', isAuthenticated, asyncHandler(async (req, res) => {
  const { data: post, error } = await getLfgPost(req.params.id, res.locals.supabase);
  if (error || !post) return sendError(req, res, error || null);
  const opened = await gameTables.openForPost(actorFromLocals(res.locals), post);
  if (!opened.data) return sendRouteError(req, res, opened.error);
  res.header('HX-Location', `/tables/${opened.data.id}`).send();
}));
```

Require `sendRouteError` from `../util/http-error` if `routes/lfg.js` doesn't already. Register the route with the other `/:id/...` POST routes, and validate `req.params.id` the way the neighbouring routes do.

In `views/lfg-post.handlebars`, replace the Party Stats header's `{{#if (gt approvedCount 0)}}<a …>Open as a draft table</a>{{/if}}` with:

```handlebars
      {{#if linkedTableId}}
      <a class="button is-small is-link is-light" href="/tables/{{linkedTableId}}">
        <span class="icon"><i class="fas fa-users"></i></span><span>Open table</span>
      </a>
      {{else if canOpenTable}}
      <button type="button" class="button is-small is-link" hx-post="/lfg/{{post.id}}/table">
        <span class="icon"><i class="fas fa-users"></i></span><span>Open table</span>
      </button>
      {{else if (gt approvedCount 0)}}
      <a class="button is-small is-light" href="/tables/new?c={{partyCsv}}">
        <span class="icon"><i class="fas fa-users"></i></span><span>Open as a draft table</span>
      </a>
      {{/if}}
```

Update `views/lfg-post.test.js` if it pins the old markup. It should assert the three branches by their `href` / `hx-post`.

- [ ] **Step 6: Run the tests**

Run: `bun test routes/lfg-table.test.js`, the LfgService test file, `bun test services/game-tables/service.test.js`, `bun run test:http`, and `bun run test:unit`.
Expected: all pass apart from the known pre-existing reds.

- [ ] **Step 7: Check the sync end to end against local Supabase**

Run a throwaway script from your scratch directory with `bun --env-file=.env`:
1. Create, with `supabaseAdmin`: a creator profile, a player profile with a character, an `lfg_posts` row by the creator, and an approved player `lfg_join_requests` row for the character.
2. Call `gameTables.openForPost({ profileId: creatorProfileId }, post)`. Expect one member with `lfg_join_request_id` set.
3. Call `lfgService`'s `leave` through `models/lfg.js` `deleteJoinRequest(SYSTEM_ACTOR, requestId)`. Expect the member to be gone.
4. Delete everything you created.

Record the output in your report.

- [ ] **Step 8: Commit**

```bash
git add services/lfg/service.js services/lfg/*.test.js models/lfg.js routes/lfg.js routes/lfg-table.test.js views/lfg-post.handlebars views/lfg-post.test.js services/game-tables/service.js services/game-tables/service.test.js scripts/run-tests.mjs
git commit -m "feat: open a game table from an LFG post and keep it in step (#176)"
```

- [ ] **Step 9: Browser check**

Use the `run` skill, or a headless Playwright script in your scratch directory, against the local stack. Start the app on its own port and stop it by its PID; never `pkill`. Confirm and screenshot each item:
1. `/party?c=<id>` lands on `/tables/new?c=<id>`, signed out, with the roster.
2. Signed in, save the draft. The table page shows the roster, and a breakdown stat shows its Stat Scaling tooltip.
3. Add a guest with Might 3. The panel shows "Unregistered", the guest form resets to blank stats, and Edit loads the guest back into the form.
4. Sign out and open the table's URL. It is visible, with no edit controls.
5. On an LFG post you created with one approved player, Open table seats that player's character, marked LFG. Withdraw the request, reload the table, and the seat is gone.
6. At 375px width the table page has no horizontal page scroll; the breakdown table scrolls inside its container.

Report the results and screenshot paths. Fix anything that fails, re-run the affected tests, and commit the fixes.
