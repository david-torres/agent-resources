require('../util/env');
const { createClient } = require('@supabase/supabase-js');
const { adventClassList } = require('../util/enclave-consts');

// Themed pools of advanced abilities for the base 6 advent classes. Each
// pool is the full set the script seeds — 3 per class, all is_advanced: true.
//
// Cost fields are intentionally free-form text (matching existing ability
// rows) — the rules team can tighten them later. is_advanced: true marks
// these as the unlockable/earned-after-X-tier abilities per the class catalog.
const advancedAbilityPools = {
  Gunslinger: [
    {
      name: 'Deadeye',
      description: 'A single shot, called aloud. Spend 3 essence to declare a specific body part on a target you can see; for the next 10 seconds your next shot to that location calls a clean hit that ignores worn armor on that location.',
      essence_cost: '3',
      cooldown: 'Once per mission',
      duration: '10 seconds'
    },
    {
      name: 'Quicksilver Draw',
      description: 'React before the room is ready. Spend 2 essence to act first in the next combat exchange regardless of initiative, so long as you are uninjured and unengaged at the start of the round.',
      essence_cost: '2',
      cooldown: 'Once per encounter',
      duration: 'One exchange'
    },
    {
      name: 'Last Round',
      description: 'When reduced to 0 vitality, you may spend all remaining essence to fire one final shot before going down. The shot ignores cover and may be aimed at any target within range.',
      essence_cost: 'All remaining',
      cooldown: 'Once per mission',
      duration: 'Instant'
    }
  ],
  Illusionist: [
    {
      name: 'Changeling',
      description: 'Take on another face for a short while. Spend 4 essence to perfectly mirror a person you have studied for at least one minute within the last hour. Voice, mannerisms, and small details included. Touch or hostile action breaks the illusion.',
      essence_cost: '4',
      cooldown: 'Once per mission',
      duration: '10 minutes'
    },
    {
      name: 'Gaslight',
      description: 'Plant a false memory in a willing subject. Spend 3 essence and 10 uninterrupted seconds of conversation; the target sincerely believes an event you describe happened as you said, even under casual questioning.',
      essence_cost: '3',
      cooldown: 'Once per subject per mission',
      duration: 'Permanent (until contradicted with evidence)'
    },
    {
      name: 'Now You See Me',
      description: 'Vanish in plain sight. Spend 5 essence to become invisible until you attack, speak above a whisper, or move faster than a walk. The illusion shatters under direct physical contact.',
      essence_cost: '5',
      cooldown: 'Once per encounter',
      duration: 'Until broken'
    }
  ],
  Librarian: [
    {
      name: 'It Is Known',
      description: 'Speak a fact into a circle of willing listeners and it becomes true within the fiction for the next minute. Spend 4 essence; the GM adjudicates scope, but mundane physical laws still apply.',
      essence_cost: '4',
      cooldown: 'Once per mission',
      duration: '1 minute'
    },
    {
      name: 'Margin Notes',
      description: 'Take 30 seconds to skim a written or printed page (in any language) and absorb its contents verbatim. Spend 2 essence; you may quote the source as if you had read it the night before.',
      essence_cost: '2',
      cooldown: 'Once per encounter',
      duration: 'Instant'
    },
    {
      name: 'Redacted',
      description: 'Reach into a text and remove a passage from physical reality. Spend 5 essence; up to one paragraph ceases to exist for everyone present until end of scene, after which it returns unchanged.',
      essence_cost: '5',
      cooldown: 'Once per mission',
      duration: 'End of scene'
    }
  ],
  Thane: [
    {
      name: 'Oathbound',
      description: 'Swear a binding oath on a willing ally\'s name. Spend 3 essence; for the next hour, that ally cannot be magically compelled to act against their stated will, and gains +1 will against fear effects.',
      essence_cost: '3',
      cooldown: 'Once per ally per mission',
      duration: '1 hour'
    },
    {
      name: 'Hold the Line',
      description: 'Plant your feet and become immovable. Spend 2 essence; for the next minute you cannot be moved, knocked down, or teleported against your will, and you present a clear rallying point for nearby allies.',
      essence_cost: '2',
      cooldown: 'Once per encounter',
      duration: '1 minute'
    },
    {
      name: 'By My Voice',
      description: 'Speak a single short command in a tone of authority. Spend 4 essence; a single target who can hear and understand you must obey a non-suicidal, non-self-harming imperative, save resisted by will.',
      essence_cost: '4',
      cooldown: 'Once per mission',
      duration: 'Instant'
    }
  ],
  Thunderbird: [
    {
      name: 'Skyborne',
      description: 'Call down a column of still air. Spend 3 essence to levitate up to 20 feet for up to one minute; you may drift horizontally at walking pace but cannot exceed that speed.',
      essence_cost: '3',
      cooldown: 'Once per encounter',
      duration: '1 minute'
    },
    {
      name: 'Stormcaller',
      description: 'Summon a localized squall centered on a point you can see. Spend 5 essence; for the next 10 minutes the area is rain-lashed, low visibility, and difficult to hear across more than 10 feet.',
      essence_cost: '5',
      cooldown: 'Once per mission',
      duration: '10 minutes'
    },
    {
      name: 'Lightning Familiar',
      description: 'Spend 4 essence to summon a small arc of living electricity that hovers at your shoulder for an hour. It will deliver a stinging shock to any creature that strikes you in melee, and can be sent to a visible point to briefly disable a lock or device.',
      essence_cost: '4',
      cooldown: 'Once per mission',
      duration: '1 hour'
    }
  ],
  Wanderer: [
    {
      name: 'Hidden Trail',
      description: 'Sense the safest path through hostile territory. Spend 2 essence; for the next hour you and up to three traveling companions automatically notice ambushes, traps, and surveillance within 30 feet.',
      essence_cost: '2',
      cooldown: 'Once per encounter',
      duration: '1 hour'
    },
    {
      name: 'Stranger\'s Welcome',
      description: 'Walk into an unfamiliar settlement and be treated as a known quantity. Spend 3 essence; for the next hour, locals answer your polite questions freely and offer basic aid (shelter, food, directions) without suspicion.',
      essence_cost: '3',
      cooldown: 'Once per settlement per mission',
      duration: '1 hour'
    },
    {
      name: 'Wayfinder',
      description: 'Speak a place you have personally been and arrive within a mile of it. Spend 5 essence; the journey is instantaneous but disorienting, and you arrive with full travel-worn appearance as if you had walked the whole way.',
      essence_cost: '5',
      cooldown: 'Once per mission',
      duration: 'Instant'
    }
  ]
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const seedAdvancedAbilities = async () => {
  const { data: classes, error } = await supabase
    .from('classes')
    .select('id, name, abilities, rules_edition, rules_version, is_player_created')
    .eq('rules_edition', 'advent')
    .in('name', adventClassList);

  if (error) {
    console.error('Failed to fetch base classes:', error.message);
    process.exit(1);
  }

  let updated = 0;
  let skipped = 0;
  let missing = 0;

  for (const cls of classes || []) {
    const pool = advancedAbilityPools[cls.name];
    if (!pool) {
      missing++;
      console.log(`No advanced pool for "${cls.name}"; leaving alone.`);
      continue;
    }

    const advancedEntries = pool.map((ability) => ({
      name: ability.name,
      description: ability.description,
      essence_cost: ability.essence_cost,
      cooldown: ability.cooldown,
      duration: ability.duration,
      is_advanced: true
    }));

    const existing = Array.isArray(cls.abilities) ? cls.abilities : [];
    const baseAbilities = existing.filter((a) => !a || a.is_advanced !== true);
    const nextAbilities = [...baseAbilities, ...advancedEntries];

    const { error: updateError } = await supabase
      .from('classes')
      .update({ abilities: nextAbilities })
      .eq('id', cls.id);

    if (updateError) {
      console.error(`Failed to update "${cls.name}" (${cls.id}):`, updateError.message);
      continue;
    }

    updated++;
    const names = advancedEntries.map((a) => a.name).join(', ');
    console.log(
      `Seeded ${advancedEntries.length} advanced abilities for ${cls.name} (${baseAbilities.length} base + ${advancedEntries.length} advanced = ${nextAbilities.length} total): ${names}`
    );
  }

  for (const name of adventClassList) {
    if (!(classes || []).some((c) => c.name === name)) {
      missing++;
      console.log(`Class "${name}" not found in DB; run \`bun run seed:classes\` first.`);
    }
  }

  console.log(
    `\nDone. ${updated} updated, ${skipped} skipped, ${missing} missing.`
  );
  process.exit(0);
};

seedAdvancedAbilities();
