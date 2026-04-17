const { createClient } = require('@supabase/supabase-js');

const clientOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
};

const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
if (!process.env.SUPABASE_URL) {
  throw new Error('SUPABASE_URL is required');
}
if (!anonKey) {
  throw new Error('SUPABASE_ANON_KEY is required');
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
}

const supabase = createClient(process.env.SUPABASE_URL, anonKey, clientOptions);
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  clientOptions
);

const createUserClient = (accessToken) => {
  if (!accessToken) return supabase;
  return createClient(process.env.SUPABASE_URL, anonKey, {
    ...clientOptions,
    global: { headers: { Authorization: `Bearer ${accessToken}` } }
  });
};

module.exports = { supabase, supabaseAdmin, anonKey, createUserClient };
