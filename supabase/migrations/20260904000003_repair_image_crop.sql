-- image_crop is jsonb and must hold a crop object or SQL NULL. A write path that
-- passed the hidden field's raw string through instead stored a jsonb *string*:
-- `""` where the crop had been cleared, and a double-encoded crop object where
-- one had been set. Locally that is 17 classes and 125 characters. Every read is
-- a property access -- `{{character.image_crop.x}}`,
-- `{{class.image_crop.width}}` -- so a string yields undefined on every field
-- and the image silently renders uncropped. util/crop.js's applyImageCrop closed
-- the write path; this repairs the rows it left behind.
--
-- Three outcomes, mirroring util/crop.js exactly:
--
--   * `""` (and `null`/`undefined`, the other values the hidden field renders
--     for a cleared crop) -> SQL NULL. These mean "no crop".
--   * a double-encoded object that parseImageCrop would accept -> the unwrapped
--     object, rebuilt with only the six keys parseImageCrop returns.
--   * a double-encoded object it would still reject -> SQL NULL. Two rows are
--     `width: 0, height: 0`, which is not a crop; leaving them as strings would
--     keep a value no read path can use.
--
-- Values within a float-noise epsilon of the boundary are clamped onto it before
-- validating. Every affected row here is a browser rounding artifact of order
-- 1e-16 -- `x: -9.14e-17` on four classes, `height: 1.0000000000000002` on five
-- characters -- which parseImageCrop rejects as out of range, so an unwrap alone
-- would recover a crop the application still refuses to read. The epsilon is
-- deliberately tiny: anything further out of range is not noise, so the row is
-- treated as unreadable and nulled rather than guessed at.
--
-- A value that is not JSON at all is left exactly as it is and announced with a
-- NOTICE. There are none locally; on any other database that is a shape nobody
-- has looked at, and silently rewriting it would be worse than reporting it.
--
-- updated_at is trigger-owned and services/home/recent-feed.js sorts the
-- homepage feeds by it. Repairing a value the row already held is not an edit to
-- the row, so the triggers are disabled around the write -- the same discipline
-- 20260903000000 and 20260904000001 use. profiles has no such trigger.

ALTER TABLE public.classes DISABLE TRIGGER update_classes_updated_at;
ALTER TABLE public.characters DISABLE TRIGGER update_characters_updated_at;

DO $$
DECLARE
  eps CONSTANT numeric := 1e-9;
  tbl text;
  r record;
  raw text;
  obj jsonb;
  ox numeric; oy numeric; ow numeric; oh numeric;
  vx numeric; vy numeric; vw numeric; vh numeric;
  natural_w jsonb; natural_h jsonb;
  fixed jsonb;
  n_cleared int; n_recovered int; n_unreadable int; n_left int;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['classes', 'characters', 'profiles'] LOOP
    n_cleared := 0; n_recovered := 0; n_unreadable := 0; n_left := 0;

    FOR r IN EXECUTE format(
      $q$SELECT id, image_crop #>> '{}' AS raw FROM public.%I
          WHERE jsonb_typeof(image_crop) = 'string'$q$, tbl)
    LOOP
      raw := btrim(coalesce(r.raw, ''));

      IF raw = '' OR raw IN ('null', 'undefined') THEN
        fixed := NULL;
        n_cleared := n_cleared + 1;
      ELSE
        BEGIN
          obj := raw::jsonb;
        EXCEPTION WHEN others THEN
          obj := NULL;
        END;

        IF obj IS NULL OR jsonb_typeof(obj) <> 'object' THEN
          RAISE NOTICE 'image_crop repair: left %.% id=% alone, not a JSON object: %',
            'public', tbl, r.id, left(raw, 80);
          n_left := n_left + 1;
          CONTINUE;
        END IF;

        IF jsonb_typeof(obj->'x') <> 'number' OR jsonb_typeof(obj->'y') <> 'number'
           OR jsonb_typeof(obj->'width') <> 'number' OR jsonb_typeof(obj->'height') <> 'number' THEN
          fixed := NULL;
          n_unreadable := n_unreadable + 1;
        ELSE
          ox := (obj->>'x')::numeric;
          oy := (obj->>'y')::numeric;
          ow := (obj->>'width')::numeric;
          oh := (obj->>'height')::numeric;

          vx := CASE WHEN ox < 0 AND ox > -eps THEN 0 WHEN ox > 1 AND ox < 1 + eps THEN 1 ELSE ox END;
          vy := CASE WHEN oy < 0 AND oy > -eps THEN 0 WHEN oy > 1 AND oy < 1 + eps THEN 1 ELSE oy END;
          vw := CASE WHEN ow < 0 AND ow > -eps THEN 0 WHEN ow > 1 AND ow < 1 + eps THEN 1 ELSE ow END;
          vh := CASE WHEN oh < 0 AND oh > -eps THEN 0 WHEN oh > 1 AND oh < 1 + eps THEN 1 ELSE oh END;

          natural_w := obj->'naturalWidth';
          natural_h := obj->'naturalHeight';

          IF vx < 0 OR vx > 1 OR vy < 0 OR vy > 1
             OR vw <= 0 OR vw > 1 OR vh <= 0 OR vh > 1
             OR (natural_w IS NOT NULL
                 AND (jsonb_typeof(natural_w) <> 'number' OR (natural_w #>> '{}')::numeric <= 0))
             OR (natural_h IS NOT NULL
                 AND (jsonb_typeof(natural_h) <> 'number' OR (natural_h #>> '{}')::numeric <= 0)) THEN
            fixed := NULL;
            n_unreadable := n_unreadable + 1;
          ELSE
            -- Keep the stored jsonb for every field the clamp did not move, so
            -- the only bytes this migration changes are the ones it had to.
            fixed := jsonb_build_object(
              'x',      CASE WHEN vx IS DISTINCT FROM ox THEN to_jsonb(vx) ELSE obj->'x' END,
              'y',      CASE WHEN vy IS DISTINCT FROM oy THEN to_jsonb(vy) ELSE obj->'y' END,
              'width',  CASE WHEN vw IS DISTINCT FROM ow THEN to_jsonb(vw) ELSE obj->'width' END,
              'height', CASE WHEN vh IS DISTINCT FROM oh THEN to_jsonb(vh) ELSE obj->'height' END);
            IF natural_w IS NOT NULL THEN fixed := fixed || jsonb_build_object('naturalWidth', natural_w); END IF;
            IF natural_h IS NOT NULL THEN fixed := fixed || jsonb_build_object('naturalHeight', natural_h); END IF;
            n_recovered := n_recovered + 1;
          END IF;
        END IF;
      END IF;

      EXECUTE format('UPDATE public.%I SET image_crop = $1 WHERE id = $2', tbl)
        USING fixed, r.id;
    END LOOP;

    RAISE NOTICE 'image_crop repair on public.%: % cleared to NULL, % crops recovered, % unreadable nulled, % left alone',
      tbl, n_cleared, n_recovered, n_unreadable, n_left;
  END LOOP;
END $$;

ALTER TABLE public.classes ENABLE TRIGGER update_classes_updated_at;
ALTER TABLE public.characters ENABLE TRIGGER update_characters_updated_at;
