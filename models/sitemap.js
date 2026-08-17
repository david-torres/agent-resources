const { supabase } = require('./_base');

// Sitemap listings. Every query here runs on the anon singleton on purpose:
// the sitemap is a public document, so the rows it can see should be exactly
// the rows a signed-out visitor can see. The explicit is_public/is_published
// filters below are belt-and-braces on top of RLS, and they double as the
// definition of "crawlable" for anything RLS leaves readable but the routes
// still gate (see canViewPage / canViewClass).

// PostgREST caps a single response at 1000 rows, so every listing pages with
// .range() until it runs dry or hits its cap. Ordering is by `id` rather than
// recency: range pagination over a table that is being written to needs a
// stable sort, or rows shift between pages and get skipped or duplicated.
const PAGE_SIZE = 1000;

const fetchAllRows = async (buildQuery, limit) => {
  const rows = [];

  for (let offset = 0; offset < limit; offset += PAGE_SIZE) {
    const size = Math.min(PAGE_SIZE, limit - offset);
    const { data, error } = await buildQuery().range(offset, offset + size - 1);
    if (error) {
      console.error(error);
      return { data: null, error };
    }
    rows.push(...(data || []));
    // A short page means the table is exhausted -- stop before spending a
    // round trip on a range we know is empty.
    if (!data || data.length < size) break;
  }

  return { data: rows, error: null };
};

// hide_from_search is honored here for the same reason models/character.js
// honors it on the homepage feed and in search: opting a character out of
// discovery has to mean opting it out of the sitemap too, which is the most
// literal discovery surface there is.
const listPublicCharacters = ({ limit }, client = supabase) => fetchAllRows(() => client
  .from('characters')
  .select('id, name, updated_at')
  .eq('is_public', true)
  .eq('hide_from_search', false)
  .order('id', { ascending: true }), limit);

const listPublicMissions = ({ limit }, client = supabase) => fetchAllRows(() => client
  .from('missions')
  .select('id, updated_at')
  .eq('is_public', true)
  .order('id', { ascending: true }), limit);

const listPublicClasses = ({ limit }, client = supabase) => fetchAllRows(() => client
  .from('classes')
  .select('id, name, updated_at')
  .eq('is_public', true)
  .order('id', { ascending: true }), limit);

// access_level 'authenticated' and 'admin' pages are excluded even though they
// exist and are published: routes/pages.js gates them, so a crawler following
// the URL would only ever get an error page.
const listPublicPages = ({ limit }, client = supabase) => fetchAllRows(() => client
  .from('pages')
  .select('slug, updated_at')
  .eq('is_published', true)
  .eq('access_level', 'public')
  .order('id', { ascending: true }), limit);

// profiles has no updated_at column, so these entries carry no lastmod.
const listPublicProfiles = ({ limit }, client = supabase) => fetchAllRows(() => client
  .from('profiles')
  .select('name')
  .eq('is_public', true)
  .order('id', { ascending: true }), limit);

module.exports = {
  PAGE_SIZE,
  listPublicCharacters,
  listPublicMissions,
  listPublicClasses,
  listPublicPages,
  listPublicProfiles
};
