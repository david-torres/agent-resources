require('dotenv').config();

const DEPRECATED_ALIASES = [
  ['SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY']
];

for (const [deprecated, current] of DEPRECATED_ALIASES) {
  if (process.env[current] === undefined || process.env[current] === '') {
    if (process.env[deprecated]) {
      console.warn(
        `[env] ${deprecated} is deprecated; use ${current}. Falling back to ${deprecated} for this run.`
      );
      process.env[current] = process.env[deprecated];
    }
  }
}
