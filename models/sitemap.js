const { supabase } = require('./_base');

// Every query runs on the anon singleton on purpose: the sitemap is a public
// document, so the rows it sees should be exactly the rows a signed-out visitor
// sees. The explicit is_public/is_published filters are belt-and-braces on top
// of RLS.

// PostgREST caps a response at 1000 rows, so listings page with .range().
// Ordered by `id`, not recency: range pagination over a table being written to
// needs a stable sort, or rows shift between pages and get skipped.
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
    // A short page means the table is exhausted.
    if (!data || data.length < size) break;
  }

  return { data: rows, error: null };
};

// hide_from_search is honored for the same reason models/character.js honors it
// in search and the homepage feed: opting out of discovery has to mean opting
// out of the sitemap too.
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

// Published 'authenticated'/'admin' pages are excluded: routes/pages.js gates
// them, so a crawler following the URL only gets an error page.
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
