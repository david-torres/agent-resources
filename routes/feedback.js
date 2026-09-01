const express = require('express');
const multer = require('multer');
const router = express.Router();

const { isAuthenticated } = require('../util/auth');
const { createRateLimiter } = require('../util/rate-limit');
const { FeedbackService, MAX_SCREENSHOT_BYTES, SCREENSHOT_TYPES } = require('../services/feedback/service');
const feedbackRepository = require('../services/feedback/repository');
const github = require('../services/feedback/github');
const { asyncHandler } = require('../util/async-handler');

const feedbackService = new FeedbackService(feedbackRepository, github);

// Screenshots arrive as multipart rather than JSON so the image never has to
// be base64'd through the global express.json() body limit.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SCREENSHOT_BYTES, files: 1 },
  // First gate only: the declared type is client-supplied. The authoritative
  // magic-byte check lives in services/feedback/service.js.
  fileFilter: (req, file, cb) => cb(null, SCREENSHOT_TYPES.has(file.mimetype))
});

// Filing an issue writes to a public tracker, so the limit is deliberately
// tight: enough for a user hitting several problems in one session, not
// enough to flood the repository. Keyed by profile, not by token, because
// this is a session-authenticated route.
const reportLimiter = createRateLimiter({ max: 5, windowMs: 10 * 60_000 });

// Multer rejects an oversized upload by throwing into the router's error
// path; without this the user would see a bare 500 instead of a message
// naming the size limit.
const uploadScreenshot = (req, res, next) => upload.single('screenshot')(req, res, (err) => {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'That screenshot is too large. Try again without it.' });
  }
  return next(err);
});

router.post('/', isAuthenticated, uploadScreenshot, asyncHandler(async (req, res) => {
  const { profile } = res.locals;

  if (!reportLimiter.check(profile?.id || res.locals.user?.id || 'anon')) {
    return res.status(429).json({ error: 'You have filed several reports recently. Please try again in a few minutes.' });
  }

  const { data, error } = await feedbackService.submitReport({
    input: {
      kind: req.body?.kind,
      title: req.body?.title,
      description: req.body?.description,
      page_url: req.body?.page_url,
      browser_info: req.body?.browser_info,
      console_log: req.body?.console_log
    },
    screenshot: req.file,
    reporter: { name: profile?.name || null, profileId: profile?.id || null }
  });

  if (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }

  return res.status(201).json(data);
}));

module.exports = router;
