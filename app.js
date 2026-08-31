const express = require('express');
const exphbs = require('express-handlebars');
const helpers = require('handlebars-helpers')();
const {
  times, date_tz, time_ago, calendar_link, getTotalV1MissionsNeeded, getTotalV2MissionsNeeded,
  setVariable, encodeURIComponentH, dump, videoEmbed, isSupportedVideoUrl, substring,
  concat, effectiveRulesVersion, wordCount, perksForAbility, nextPerkPosition, json
} = require('./util/handlebars');
const { renderMarkdown } = require('./util/markdown');
const { sendError } = require('./util/http-error');
const range = require('handlebars-helper-range');
const path = require('path');

const homeRoutes = require('./routes/home');
const authRoutes = require('./routes/auth');
const charactersRoutes = require('./routes/characters');
const lfgRoutes = require('./routes/lfg');
const partyRoutes = require('./routes/party');
const profileRoutes = require('./routes/profile');
const missionsRoutes = require('./routes/missions');
const classesRoutes = require('./routes/classes');
const libraryRoutes = require('./routes/library');
const badgesRoutes = require('./routes/badges');
const pagesRoutes = require('./routes/pages');
const navRoutes = require('./routes/nav');
const agentRoutes = require('./routes/agent');
const sitemapRoutes = require('./routes/sitemap');
const botLinkRoutes = require('./routes/bot-link');
const feedbackRoutes = require('./routes/feedback');
const { loadNavItems } = require('./util/nav-loader');
const { openGraphDefaults } = require('./util/open-graph');
const { isGithubConfigured } = require('./services/feedback/github');

const createApp = () => {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, 'public')));

  app.engine('handlebars', exphbs.engine({
    layoutsDir: path.join(__dirname, 'views/layouts'),
    partialsDir: path.join(__dirname, 'views/partials'),
    defaultLayout: 'main',
    helpers: {
      ...helpers,
      times,
      range,
      date_tz,
      time_ago,
      calendar_link,
      encodeURIComponentH,
      getTotalV1MissionsNeeded,
      getTotalV2MissionsNeeded,
      setVariable,
      dump,
      videoEmbed,
      isSupportedVideoUrl,
      substring,
      concat,
      effectiveRulesVersion,
      wordCount,
      perksForAbility,
      nextPerkPosition,
      json,
      markdown: renderMarkdown
    }
  }));
  app.set('view engine', 'handlebars');
  app.set('views', path.join(__dirname, 'views'));

  app.use((req, res, next) => {
    res.locals.supabaseUrl = process.env.SUPABASE_URL;
    res.locals.supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    // The reporter widget is only rendered when a report could actually be
    // filed, so an unconfigured deploy shows no button rather than one that
    // fails on submit.
    res.locals.feedbackEnabled = isGithubConfigured();
    next();
  });

  // Before loadNavItems: the sitemap renders no layout, so it has no use for
  // nav items and no reason to pay for the query.
  app.use('/', sitemapRoutes);

  app.use(openGraphDefaults);
  app.use(loadNavItems);
  app.use('/', homeRoutes);
  app.use('/auth', authRoutes);
  app.use('/profile', profileRoutes);
  app.use('/characters', charactersRoutes);
  app.use('/lfg', lfgRoutes);
  app.use('/party', partyRoutes);
  app.use('/missions', missionsRoutes);
  app.use('/classes', classesRoutes);
  app.use('/library', libraryRoutes);
  app.use('/badges', badgesRoutes);
  app.use('/pages', pagesRoutes);
  app.use('/nav', navRoutes);
  app.use('/link/bot', botLinkRoutes);
  app.use('/feedback', feedbackRoutes);
  app.use('/api/agent', agentRoutes);

  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    if (res.headersSent) return next(err);
    return sendError(req, res, err);
  });

  return app;
};

module.exports = { createApp };
