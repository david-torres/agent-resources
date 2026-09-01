-- Storage bucket for screenshots attached to in-app bug reports.
--
-- Public on purpose: the screenshot is embedded in a GitHub issue, and GitHub
-- fetches it anonymously when it renders the issue body. A private bucket
-- would need a signed URL, which shows a broken image once it expires.
--
-- Uploads happen server-side with the service key (see
-- services/feedback/repository.js), which bypasses RLS, so no INSERT policy is
-- needed -- and none is added deliberately: no browser session may write here.
-- Reads need no policy either; storage serves public buckets without one.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'bug-screenshots',
    'bug-screenshots',
    true,
    4194304, -- 4 MB, matching MAX_SCREENSHOT_BYTES in services/feedback/service.js
    ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;
