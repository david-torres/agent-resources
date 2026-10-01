-- Aspirant p. 97: optional stakes; existing and ordinary missions stay Conventional.
alter table public.missions
  add column difficulty text not null default 'conventional'
    check (difficulty in ('conventional', 'critical', 'crisis')),
  add column danger text not null default 'conventional'
    check (danger in ('conventional', 'critical', 'crisis'));

-- Mission merges retain the primary mission's stakes, as they do its outcome.
