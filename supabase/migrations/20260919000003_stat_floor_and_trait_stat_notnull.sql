-- Completes the nullable-now/NOT-NULL-later split that
-- 20260919000000_traits_stat_affiliation.sql's header names this migration
-- as owning: traits.stat becomes NOT NULL now that every write path (Tasks
-- 4, 6 and 8) supplies a value.
--
-- A real character edit could have written stat = null over a row
-- 20260919000000 already backfilled: that migration ran before any save path
-- learned to carry `stat`, so a save between the two tasks would submit a
-- trait with no stat and overwrite the backfilled value with null. Nothing
-- errored at the time -- the column was nullable -- so the damage would only
-- surface as this migration's own NOT NULL failing to apply. This migration
-- heals that hole itself by repeating 20260919000000's name-based backfill
-- for any row left with stat IS NULL, using the same personalityMap
-- vocabulary snapshot (util/enclave-consts.js), generated the same way with:
--   node -e "const { personalityMap } = require('./util/enclave-consts.js');
--   for (const [stat, words] of Object.entries(personalityMap))
--     for (const w of words) console.log(\`    ('${w}','${stat}'),\`);"
-- On a clean database (every trait already has a stat) this backfill matches
-- zero rows -- a no-op, which is the point.
WITH vocabulary (word, stat) AS (
  VALUES
    ('indulgent','vitality'),
    ('fun-loving','vitality'),
    ('greedy','vitality'),
    ('optimistic','vitality'),
    ('forceful','might'),
    ('aggressive','might'),
    ('retaliatory','might'),
    ('brave','might'),
    ('tough','resilience'),
    ('blunt','resilience'),
    ('no-nonsense','resilience'),
    ('grim','resilience'),
    ('compassionate','spirit'),
    ('warm','spirit'),
    ('sentimental','spirit'),
    ('giving','spirit'),
    ('ambitious','arcane'),
    ('powerhungry','arcane'),
    ('haughty','arcane'),
    ('scheming','arcane'),
    ('self-controlled','will'),
    ('serious','will'),
    ('calm','will'),
    ('principled','will'),
    ('alert','sensory'),
    ('aloof','sensory'),
    ('organized','sensory'),
    ('wary','sensory'),
    ('smooth','reflex'),
    ('ingratiating','reflex'),
    ('easygoing','reflex'),
    ('sly','reflex'),
    ('enthusiastic','vigor'),
    ('gung-ho','vigor'),
    ('extroverted','vigor'),
    ('boisterous','vigor'),
    ('confident','skill'),
    ('cocky','skill'),
    ('showoffish','skill'),
    ('cool','skill'),
    ('opinionated','intelligence'),
    ('articulate','intelligence'),
    ('pretentious','intelligence'),
    ('analytical','intelligence'),
    ('carefree','luck'),
    ('cheeky','luck'),
    ('whimsical','luck'),
    ('complacent','luck')
)
UPDATE public.traits t
SET stat = v.stat
FROM vocabulary v
WHERE lower(btrim(t.name)) = v.word
  AND t.stat IS NULL;

-- Fail loudly rather than let a still-null row trip over the NOT NULL below
-- with a less informative error. A row that fails here is a Trait whose name
-- is not in the closed vocabulary (a self-made Aspirant Trait, pg. 3) and
-- was never backfilled by either migration -- a real data problem this
-- migration should surface, not silently paper over.
DO $$
DECLARE unmapped integer;
BEGIN
  SELECT count(*) INTO unmapped FROM public.traits WHERE stat IS NULL;
  IF unmapped > 0 THEN
    RAISE EXCEPTION 'traits.stat backfill left % row(s) unmapped', unmapped;
  END IF;
END $$;

-- Re-add traits_stat_known without the `stat IS NULL OR` half now that the
-- column can no longer be null, then require a value.
ALTER TABLE public.traits DROP CONSTRAINT traits_stat_known;
ALTER TABLE public.traits ADD CONSTRAINT traits_stat_known CHECK (
  stat IN (
    'vitality','might','resilience','spirit','arcane','will',
    'sensory','reflex','vigor','skill','intelligence','luck'
  )
);
ALTER TABLE public.traits ALTER COLUMN stat SET NOT NULL;

-- The measured live minimum across all 327 characters is 0 with no
-- negatives, so this floor costs no existing row. Deliberately no matching
-- upper bound: ENCLAVE: Aspirant V1 pg. 3's "Scaling Beyond" sidebar states
-- there is no theoretical maximum, and the real Cap (util/stat-caps.js's
-- statCapFor) is derived per stat from a character's Traits and purchases --
-- data a single-column CHECK cannot see. A stat of 9999 is expected to be
-- accepted here; the application refuses an illegal value, the column does
-- not.
ALTER TABLE public.characters
  ADD CONSTRAINT characters_vitality_floor CHECK (vitality >= 0),
  ADD CONSTRAINT characters_might_floor CHECK (might >= 0),
  ADD CONSTRAINT characters_resilience_floor CHECK (resilience >= 0),
  ADD CONSTRAINT characters_spirit_floor CHECK (spirit >= 0),
  ADD CONSTRAINT characters_arcane_floor CHECK (arcane >= 0),
  ADD CONSTRAINT characters_will_floor CHECK (will >= 0),
  ADD CONSTRAINT characters_sensory_floor CHECK (sensory >= 0),
  ADD CONSTRAINT characters_reflex_floor CHECK (reflex >= 0),
  ADD CONSTRAINT characters_vigor_floor CHECK (vigor >= 0),
  ADD CONSTRAINT characters_skill_floor CHECK (skill >= 0),
  ADD CONSTRAINT characters_intelligence_floor CHECK (intelligence >= 0),
  ADD CONSTRAINT characters_luck_floor CHECK (luck >= 0);
