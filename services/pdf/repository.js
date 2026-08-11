const { supabaseAdmin } = require('../../models/_base');

// The only consumer of supabaseAdmin.storage for the pdf domain. pdf storage
// is a persistence adapter; authorization belongs to the owning domain's
// policy (class/rules) — this repository has no policy or actor of its own.
module.exports = {
  uploadObject: (bucket, storagePath, bytes, opts = {}) =>
    supabaseAdmin.storage.from(bucket).upload(storagePath, bytes, opts),
  removeObject: (bucket, storagePath) =>
    supabaseAdmin.storage.from(bucket).remove([storagePath]),
  createSignedUrl: (bucket, storagePath, ttl) =>
    supabaseAdmin.storage.from(bucket).createSignedUrl(storagePath, ttl)
};
