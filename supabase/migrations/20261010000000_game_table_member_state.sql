-- Live tracker state: one row per seated member (Stamina, Essence, use
-- counts, cooldowns, Conduit-imposed Limiters, and the state before the last
-- action for undo). Participants read it -- and receive its Realtime changes --
-- under RLS; the character's owner or the table's creator/Conduit writes it.
-- Rows are created by trigger when a member is seated and go with the member.

create table if not exists public.game_table_member_state (
  member_id uuid primary key references public.game_table_members(id) on delete cascade,
  table_id uuid not null references public.game_tables(id) on delete cascade,
  stamina_threshold smallint not null default 0 check (stamina_threshold between 0 and 3),
  stamina_spent smallint not null default 0 check (stamina_spent >= 0),
  essence_threshold smallint not null default 0 check (essence_threshold between 0 and 3),
  essence_spent smallint not null default 0 check (essence_spent >= 0),
  use_counts jsonb not null default '{}'::jsonb check (jsonb_typeof(use_counts) = 'object'),
  cooldowns jsonb not null default '{}'::jsonb check (jsonb_typeof(cooldowns) = 'object'),
  imposed_limiters jsonb not null default '{}'::jsonb check (jsonb_typeof(imposed_limiters) = 'object'),
  undo jsonb,
  version integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

create index if not exists idx_game_table_member_state_table on public.game_table_member_state(table_id);

create or replace function public.create_game_table_member_state()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into game_table_member_state (member_id, table_id)
  values (new.id, new.table_id)
  on conflict (member_id) do nothing;
  return new;
end;
$$;

revoke all on function public.create_game_table_member_state() from public, anon, authenticated;

drop trigger if exists game_table_members_create_state on public.game_table_members;
create trigger game_table_members_create_state
  after insert on public.game_table_members
  for each row
  execute function public.create_game_table_member_state();

insert into public.game_table_member_state (member_id, table_id)
select id, table_id from public.game_table_members
on conflict (member_id) do nothing;

alter table public.game_table_member_state enable row level security;

drop policy if exists "game_table_member_state_participant_select" on public.game_table_member_state;
create policy "game_table_member_state_participant_select"
  on public.game_table_member_state for select
  using (is_game_table_participant(table_id));

-- The owner of the seated character, or the table's creator/Conduit (guests
-- have no owner, so only they). updated_by can only name the caller.
drop policy if exists "game_table_member_state_tracker_update" on public.game_table_member_state;
create policy "game_table_member_state_tracker_update"
  on public.game_table_member_state for update
  using (exists (
    select 1 from game_table_members m
    where m.id = member_id
      and (can_manage_game_table(m.table_id) or (m.character_id is not null and owns_character(m.character_id)))
  ))
  with check (
    exists (
      select 1 from game_table_members m
      where m.id = member_id
        and (can_manage_game_table(m.table_id) or (m.character_id is not null and owns_character(m.character_id)))
    )
    and (updated_by is null or exists (select 1 from profiles p where p.id = updated_by and p.user_id = auth.uid()))
  );

revoke all on public.game_table_member_state from anon, authenticated;

do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select on public.game_table_member_state to authenticated';
    execute 'grant update (stamina_threshold, stamina_spent, essence_threshold, essence_spent, use_counts, cooldowns, imposed_limiters, undo, version, updated_at, updated_by) on public.game_table_member_state to authenticated';
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_table_member_state'
     ) then
    execute 'alter publication supabase_realtime add table public.game_table_member_state';
  end if;
end
$do$;
