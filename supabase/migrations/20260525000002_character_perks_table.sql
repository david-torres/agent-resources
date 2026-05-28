-- Structured Ability Perks for v2 characters. v1 characters never write
-- here; they keep using the freeform characters.perks TEXT field.

CREATE TABLE IF NOT EXISTS public.character_perks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    character_id UUID NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
    class_ability_id UUID NOT NULL REFERENCES public.class_abilities(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    compounds_with UUID REFERENCES public.character_perks(id) ON DELETE SET NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_character_perks_character ON public.character_perks(character_id);
CREATE INDEX IF NOT EXISTS idx_character_perks_ability   ON public.character_perks(class_ability_id);

ALTER TABLE public.character_perks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "character_perks_select" ON public.character_perks;
DROP POLICY IF EXISTS "character_perks_mutate" ON public.character_perks;

-- Mirror class_abilities visibility: a perk is visible when its owning
-- character is visible (public, owner, or admin).
CREATE POLICY "character_perks_select"
    ON public.character_perks FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM public.characters c
            JOIN public.profiles p ON p.id = c.creator_id
            WHERE c.id = character_perks.character_id
              AND (c.is_public = true OR p.user_id = auth.uid() OR is_admin())
        )
    );

-- Mutation requires character ownership or admin.
CREATE POLICY "character_perks_mutate"
    ON public.character_perks FOR ALL
    USING (
        EXISTS (
            SELECT 1
            FROM public.characters c
            JOIN public.profiles p ON p.id = c.creator_id
            WHERE c.id = character_perks.character_id
              AND (p.user_id = auth.uid() OR is_admin())
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.characters c
            JOIN public.profiles p ON p.id = c.creator_id
            WHERE c.id = character_perks.character_id
              AND (p.user_id = auth.uid() OR is_admin())
        )
    );
