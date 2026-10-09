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

revoke execute on function public.can_manage_game_table(uuid), public.owns_character(uuid), public.is_game_table_participant(uuid) from public, anon;
grant execute on function public.can_manage_game_table(uuid), public.owns_character(uuid), public.is_game_table_participant(uuid) to authenticated, service_role;

-- Locks the table row so concurrent inserts serialize; SECURITY DEFINER so the
-- count sees every member regardless of the caller's RLS.
create or replace function public.enforce_game_table_seat_cap()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform 1 from game_tables where id = new.table_id for update;
  if (select count(*) from game_table_members where table_id = new.table_id) >= 8 then
    raise exception 'A table seats at most 8.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists game_table_members_seat_cap on public.game_table_members;
create trigger game_table_members_seat_cap
  before insert on public.game_table_members
  for each row
  execute function public.enforce_game_table_seat_cap();

-- Deleting a post cascades to its join requests, and a withdrawn request
-- unseats its character. Detach the post's seats first so the table keeps
-- its roster as hand seats when the whole post goes.
create or replace function public.keep_game_table_seats_on_post_delete()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update game_table_members m
     set lfg_join_request_id = null
    from lfg_join_requests r
   where r.id = m.lfg_join_request_id and r.lfg_post_id = old.id;
  return old;
end;
$$;

revoke execute on function public.keep_game_table_seats_on_post_delete() from public, anon, authenticated;

drop trigger if exists lfg_posts_keep_game_table_seats on public.lfg_posts;
create trigger lfg_posts_keep_game_table_seats
  before delete on public.lfg_posts
  for each row
  execute function public.keep_game_table_seats_on_post_delete();

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
