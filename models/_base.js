const { createClient } = require('@supabase/supabase-js');

const clientOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
};

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, clientOptions);
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY,
  clientOptions
);

module.exports = { supabase, supabaseAdmin };
