-- Fix: redeem_class_code{,_for_user} previously used ON CONFLICT DO NOTHING,
-- which silently dropped permanent unlocks whenever a user already had a row
-- (e.g. an expired starter-trial row) for that class. The code was marked
-- consumed (used_count++) but the existing row's expires_at was left in place.
--
-- New behaviour: upsert. A redeemed code always grants a permanent unlock,
-- so an existing row gets its expires_at cleared. unlocked_at is kept at the
-- earlier of the two so we don't lose the "first granted" date.

CREATE OR REPLACE FUNCTION redeem_class_code(p_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_code RECORD;
BEGIN
    SELECT *
    INTO v_code
    FROM class_unlock_codes
    WHERE code = p_code
      AND (expires_at IS NULL OR expires_at > now())
      AND used_count < max_uses
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid or expired code';
    END IF;

    INSERT INTO class_unlocks(user_id, class_id, unlocked_at, expires_at)
    VALUES (auth.uid(), v_code.class_id, now(), NULL)
    ON CONFLICT (user_id, class_id) DO UPDATE
    SET expires_at = NULL,
        unlocked_at = LEAST(class_unlocks.unlocked_at, EXCLUDED.unlocked_at);

    UPDATE class_unlock_codes
    SET used_count = used_count + 1,
        last_redeemed_by = auth.uid(),
        last_redeemed_at = now()
    WHERE id = v_code.id;

    RETURN v_code.class_id;
END;
$$;

CREATE OR REPLACE FUNCTION redeem_class_code_for_user(p_code text, p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_code RECORD;
BEGIN
    SELECT *
    INTO v_code
    FROM class_unlock_codes
    WHERE code = p_code
      AND (expires_at IS NULL OR expires_at > now())
      AND used_count < max_uses
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid or expired code';
    END IF;

    INSERT INTO class_unlocks(user_id, class_id, unlocked_at, expires_at)
    VALUES (p_user_id, v_code.class_id, now(), NULL)
    ON CONFLICT (user_id, class_id) DO UPDATE
    SET expires_at = NULL,
        unlocked_at = LEAST(class_unlocks.unlocked_at, EXCLUDED.unlocked_at);

    UPDATE class_unlock_codes
    SET used_count = used_count + 1,
        last_redeemed_by = p_user_id,
        last_redeemed_at = now()
    WHERE id = v_code.id;

    RETURN v_code.class_id;
END;
$$;
