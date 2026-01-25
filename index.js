const express = require('express');
const exphbs = require('express-handlebars');
const helpers = require('handlebars-helpers')();
const { times, date_tz, calendar_link, getTotalV1MissionsNeeded, getTotalV2MissionsNeeded, setVariable, encodeURIComponentH, dump, videoEmbed, isSupportedVideoUrl } = require('./util/handlebars');
const range = require('handlebars-helper-range');
const path = require('path');
require('dotenv').config();

const homeRoutes = require('./routes/home');
const authRoutes = require('./routes/auth');
const charactersRoutes = require('./routes/characters');
const lfgRoutes = require('./routes/lfg');
const profileRoutes = require('./routes/profile');
const missionsRoutes = require('./routes/missions');
const classesRoutes = require('./routes/classes');
const rulesRoutes = require('./routes/rules');
const pagesRoutes = require('./routes/pages');
const navRoutes = require('./routes/nav');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Set up Handlebars
app.engine('handlebars', exphbs.engine({
  layoutsDir: path.join(__dirname, 'views/layouts'),
  partialsDir: path.join(__dirname, 'views/partials'),
  defaultLayout: 'main',
    helpers: {
      ...helpers,
      times,
      range,
      date_tz,
      calendar_link,
      encodeURIComponentH,
      getTotalV1MissionsNeeded,
      getTotalV2MissionsNeeded,
      setVariable,
      dump,
      videoEmbed,
      isSupportedVideoUrl
  }
}));
app.set('view engine', 'handlebars');
app.set('views', path.join(__dirname, 'views'));

// pass supabaseUrl and supabaseKey to the frontend
app.use((req, res, next) => {
  res.locals.supabaseUrl = process.env.SUPABASE_URL;
  res.locals.supabaseKey = process.env.SUPABASE_KEY;
  next();
});

// Load navigation items for routes that don't use auth middleware
// (Routes with auth middleware will load nav items in the auth middleware itself)
const { loadNavItems } = require('./util/nav-loader');
app.use(loadNavItems);

// Routes
app.use('/', homeRoutes);
app.use('/auth', authRoutes);
app.use('/profile', profileRoutes);
app.use('/characters', charactersRoutes);
app.use('/lfg', lfgRoutes);
app.use('/missions', missionsRoutes);
app.use('/classes', classesRoutes);
app.use('/rules', rulesRoutes);
app.use('/pages', pagesRoutes);
app.use('/nav', navRoutes);

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
