const crypto = require('crypto');
const { normalizeFeedbackInput } = require('./input');
const { buildIssueBody, buildIssueTitle, labelsFor } = require('./body');

const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;

// Client-declared mimetypes are spoofable, so the extension comes from this
// map (never from the uploaded filename) and anything unlisted is refused.
const SCREENSHOT_TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp']
]);

// Magic bytes for the three types above. A file whose declared type and
// leading bytes disagree is dropped rather than published to a public bucket.
const looksLikeImage = (buffer, mimetype) => {
  if (!buffer || buffer.length < 12) return false;
  if (mimetype === 'image/png') {
    return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  }
  if (mimetype === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimetype === 'image/webp') {
    return buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
};

// Best effort by design: a storage failure must not cost the user their
// report, so it degrades to an issue that says the screenshot was lost.
const storeScreenshot = async (repository, file, profileId) => {
  if (!file || !file.buffer?.length) return { url: null, failed: false };

  const extension = SCREENSHOT_TYPES.get(file.mimetype);
  if (!extension || file.buffer.length > MAX_SCREENSHOT_BYTES || !looksLikeImage(file.buffer, file.mimetype)) {
    return { url: null, failed: true };
  }

  const storagePath = `${profileId || 'unknown'}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${extension}`;
  const { error } = await repository.uploadScreenshot(storagePath, file.buffer, file.mimetype);
  if (error) {
    console.error('Feedback screenshot upload failed:', error.message || error);
    return { url: null, failed: true };
  }

  return { url: repository.getPublicUrl(storagePath), failed: false };
};

class FeedbackService {
  /**
   * @param {object} repository services/feedback/repository.js
   * @param {object} github services/feedback/github.js
   */
  constructor(repository, github) {
    this.repository = repository;
    this.github = github;
  }

  /**
   * Validate a submitted report, store its screenshot, and file the issue.
   *
   * @param {object} params
   * @param {object} params.input Raw request fields.
   * @param {object} [params.screenshot] Multer memory-storage file.
   * @param {{name?: string, profileId?: string}} params.reporter
   * @returns {Promise<{data: {url: string, number: number}|null, error: {status: number, message: string}|null}>}
   */
  async submitReport({ input, screenshot, reporter }) {
    if (!this.github.isGithubConfigured()) {
      return { data: null, error: { status: 503, message: 'Issue reporting is not configured on this server.' } };
    }

    const { data: report, error } = normalizeFeedbackInput(input);
    if (error) return { data: null, error };

    // Only a bug report carries a screenshot; a feature request that posts one
    // has it dropped, mirroring how input.js drops its other diagnostics.
    const { url: screenshotUrl, failed: screenshotFailed } = report.kind === 'bug'
      ? await storeScreenshot(this.repository, screenshot, reporter?.profileId)
      : { url: null, failed: false };

    return this.github.createIssue({
      title: buildIssueTitle(report),
      body: buildIssueBody({
        ...report,
        screenshotUrl,
        screenshotFailed,
        reporter,
        submittedAt: new Date().toISOString()
      }),
      labels: labelsFor(report)
    });
  }
}

module.exports = { FeedbackService, MAX_SCREENSHOT_BYTES, SCREENSHOT_TYPES };
