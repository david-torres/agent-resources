const { supabaseAdmin } = require('../../models/_base');

const SCREENSHOT_BUCKET = 'bug-screenshots';

// The only consumer of supabaseAdmin.storage for the feedback domain.
// Screenshots land in a PUBLIC bucket on purpose: GitHub fetches the image
// anonymously when it renders the issue, so a signed URL would show a broken
// image the moment it expired.
module.exports = {
  SCREENSHOT_BUCKET,

  uploadScreenshot: (storagePath, bytes, contentType) =>
    supabaseAdmin.storage.from(SCREENSHOT_BUCKET).upload(storagePath, bytes, {
      contentType,
      cacheControl: '31536000',
      upsert: false
    }),

  getPublicUrl: (storagePath) =>
    supabaseAdmin.storage.from(SCREENSHOT_BUCKET).getPublicUrl(storagePath).data.publicUrl
};
