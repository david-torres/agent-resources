-- Add PDF metadata to classes
ALTER TABLE classes
    ADD COLUMN IF NOT EXISTS pdf_storage_path text,
    ADD COLUMN IF NOT EXISTS pdf_updated_at timestamptz;

-- Rules PDF catalog
CREATE TABLE IF NOT EXISTS rules_pdfs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    edition text NOT NULL,
    storage_path text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_by uuid REFERENCES profiles(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (edition, title)
);

-- Track per-user unlocks for rules PDFs
CREATE TABLE IF NOT EXISTS rules_pdf_unlocks (
    user_id uuid NOT NULL REFERENCES auth.users(id),
    profile_id uuid NOT NULL REFERENCES profiles(id),
    rules_pdf_id uuid NOT NULL REFERENCES rules_pdfs(id) ON DELETE CASCADE,
    granted_by uuid REFERENCES profiles(id),
    unlocked_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    PRIMARY KEY (user_id, rules_pdf_id)
);

-- Maintain updated_at column
CREATE TRIGGER update_rules_pdfs_updated_at
    BEFORE UPDATE ON rules_pdfs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE rules_pdfs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rules_pdf_unlocks ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Rules PDFs viewable publicly"
    ON rules_pdfs FOR SELECT
    USING (is_active = true);

CREATE POLICY "Rules PDFs admin manage"
    ON rules_pdfs FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());

CREATE POLICY "Users view own rules unlocks"
    ON rules_pdf_unlocks FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Admins manage rules unlocks"
    ON rules_pdf_unlocks FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());

