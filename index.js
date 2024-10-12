const express = require('express');
const exphbs = require('express-handlebars');
const helpers = require('handlebars-helpers')();
const { times, date_tz } = require('./util/handlebars');
const range = require('handlebars-helper-range');
const path = require('path');
require('dotenv').config();

const homeRoutes = require('./routes/home');
const authRoutes = require('./routes/auth');
const charactersRoutes = require('./routes/characters');
const lfgRoutes = require('./routes/lfg');
const profileRoutes = require('./routes/profile');

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
      times,
      range,
      date_tz
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

// Routes
app.use('/', homeRoutes);
app.use('/auth', authRoutes);
app.use('/profile', profileRoutes);
app.use('/characters', charactersRoutes);
app.use('/lfg', lfgRoutes);

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
