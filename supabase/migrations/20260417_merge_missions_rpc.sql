-- Atomic mission merge via SECURITY DEFINER function.
-- Callers must perform app-layer authorization (canEditMission) before invoking.

create or replace function public.merge_missions(
  primary_id uuid,
  secondary_id uuid,
  actor_profile_id uuid
) returns missions
language plpgsql
security definer
set search_path = public
as $$
declare
  primary_row missions;
  secondary_row missions;
  merged_summary text;
  merged_unregistered text[];
  earlier_date timestamptz;
begin
  select * into primary_row from missions where id = primary_id for update;
  if not found then raise exception 'Primary mission not found'; end if;

  select * into secondary_row from missions where id = secondary_id for update;
  if not found then raise exception 'Secondary mission not found'; end if;

  earlier_date := least(primary_row.date, secondary_row.date);

  merged_summary := coalesce(nullif(primary_row.summary, ''), '');
  if secondary_row.summary is not null and secondary_row.summary <> '' then
    if merged_summary <> '' then
      merged_summary := merged_summary || E'\n\n---\n\n' || secondary_row.summary;
    else
      merged_summary := secondary_row.summary;
    end if;
  end if;

  merged_unregistered := (
    select coalesce(array_agg(distinct x), array[]::text[])
    from unnest(
      coalesce(primary_row.unregistered_character_names, array[]::text[]) ||
      coalesce(secondary_row.unregistered_character_names, array[]::text[])
    ) as x
  );

  update missions set
    date = earlier_date,
    summary = nullif(merged_summary, ''),
    unregistered_character_names = merged_unregistered,
    media_url = coalesce(primary_row.media_url, secondary_row.media_url)
  where id = primary_id;

  insert into mission_characters (mission_id, character_id)
    select primary_id, mc.character_id
    from mission_characters mc
    where mc.mission_id = secondary_id
  on conflict on constraint unique_mission_character do nothing;

  insert into mission_editors (mission_id, profile_id, added_by)
    select primary_id, me.profile_id, actor_profile_id
    from mission_editors me
    where me.mission_id = secondary_id
  on conflict (mission_id, profile_id) do nothing;

  if secondary_row.creator_id is not null and secondary_row.creator_id <> primary_row.creator_id then
    insert into mission_editors (mission_id, profile_id, added_by)
      values (primary_id, secondary_row.creator_id, actor_profile_id)
    on conflict (mission_id, profile_id) do nothing;
  end if;

  delete from missions where id = secondary_id;

  select * into primary_row from missions where id = primary_id;
  return primary_row;
end;
$$;

-- Allow the authenticated service role (and callers through it) to execute.
grant execute on function public.merge_missions(uuid, uuid, uuid) to service_role;
