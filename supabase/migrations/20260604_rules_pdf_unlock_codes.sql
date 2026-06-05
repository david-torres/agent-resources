-- Code-redeemable unlocks for rules PDFs, mirroring class_unlock_codes and
-- redeem_class_code_for_user (incl. the 20260512 permanent-unlock upsert fix).
-- Spec: docs/superpowers/specs/2026-06-04-pdf-unlock-codes-design.md

CREATE TABLE IF NOT EXISTS rules_pdf_unlock_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE,
    rules_pdf_id uuid NOT NULL REFERENCES rules_pdfs(id) ON DELETE CASCADE,
    created_by uuid NOT NULL REFERENCES profiles(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    max_uses int NOT NULL DEFAULT 1,
    used_count int NOT NULL DEFAULT 0,
    last_redeemed_by uuid REFERENCES auth.users(id),
    last_redeemed_at timestamptz
);

ALTER TABLE rules_pdf_unlock_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rules_pdf_unlock_codes_admin_all" ON rules_pdf_unlock_codes;
CREATE POLICY "rules_pdf_unlock_codes_admin_all"
    ON rules_pdf_unlock_codes FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());

-- Atomic redemption. Always grants a permanent unlock: upserts over any
-- existing row (e.g. an expired starter-trial unlock) by clearing expires_at
-- and keeping the earlier unlocked_at.
CREATE OR REPLACE FUNCTION redeem_rules_pdf_code_for_user(p_code text, p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_code RECORD;
    v_profile_id uuid;
BEGIN
    SELECT *
    INTO v_code
    FROM rules_pdf_unlock_codes
    WHERE code = p_code
      AND (expires_at IS NULL OR expires_at > now())
      AND used_count < max_uses
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid or expired code';
    END IF;

    -- rules_pdf_unlocks.profile_id is NOT NULL; resolve it explicitly.
    SELECT id INTO v_profile_id FROM profiles WHERE user_id = p_user_id LIMIT 1;
    IF v_profile_id IS NULL THEN
        RAISE EXCEPTION 'No profile found for user';
    END IF;

    INSERT INTO rules_pdf_unlocks(user_id, profile_id, rules_pdf_id, unlocked_at, expires_at)
    VALUES (p_user_id, v_profile_id, v_code.rules_pdf_id, now(), NULL)
    ON CONFLICT (user_id, rules_pdf_id) DO UPDATE
    SET expires_at = NULL,
        unlocked_at = LEAST(rules_pdf_unlocks.unlocked_at, EXCLUDED.unlocked_at);

    UPDATE rules_pdf_unlock_codes
    SET used_count = used_count + 1,
        last_redeemed_by = p_user_id,
        last_redeemed_at = now()
    WHERE id = v_code.id;

    RETURN v_code.rules_pdf_id;
END;
$$;
