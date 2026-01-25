-- Migration: Add navigation items table
-- Run this manually in your Supabase SQL editor or database client

-- Create nav_items table
CREATE TABLE IF NOT EXISTS nav_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    label text NOT NULL,
    type text NOT NULL CHECK (type IN ('link', 'page', 'dropdown')) DEFAULT 'link',
    url text,  -- For 'link' type (can be internal or external)
    page_id uuid REFERENCES pages(id) ON DELETE SET NULL,  -- For 'page' type
    icon text,  -- FontAwesome icon class (e.g., 'fas fa-home')
    parent_id uuid REFERENCES nav_items(id) ON DELETE CASCADE,  -- For dropdown sub-items
    position integer NOT NULL DEFAULT 0,  -- Ordering within same parent
    requires_auth boolean NOT NULL DEFAULT false,  -- Show only when authenticated
    requires_admin boolean NOT NULL DEFAULT false,  -- Show only for admins
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_nav_items_parent ON nav_items(parent_id);
CREATE INDEX IF NOT EXISTS idx_nav_items_position ON nav_items(parent_id, position);
CREATE INDEX IF NOT EXISTS idx_nav_items_active ON nav_items(is_active);

-- Enable Row Level Security
ALTER TABLE nav_items ENABLE ROW LEVEL SECURITY;

-- Trigger to update updated_at timestamp (requires the function to exist)
-- If update_updated_at_column() doesn't exist, create it first:
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_nav_items_updated_at
    BEFORE UPDATE ON nav_items
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- RLS Policies for nav_items table
CREATE POLICY "Everyone can view active nav items"
    ON nav_items FOR SELECT
    USING (is_active = true);

CREATE POLICY "Only admins can create nav items"
    ON nav_items FOR INSERT
    WITH CHECK (is_admin());

CREATE POLICY "Only admins can update nav items"
    ON nav_items FOR UPDATE
    USING (is_admin())
    WITH CHECK (is_admin());

CREATE POLICY "Only admins can delete nav items"
    ON nav_items FOR DELETE
    USING (is_admin());
