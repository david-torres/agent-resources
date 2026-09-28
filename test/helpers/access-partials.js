const fs = require('fs');
const path = require('path');

const ACCESS_DIR = path.join(__dirname, '..', '..', 'views', 'partials', 'access');

// View tests build their own Handlebars instance; this registers every
// access/* partial under the name express-handlebars gives it.
const registerAccessPartials = (hb) => {
  for (const file of fs.readdirSync(ACCESS_DIR)) {
    if (!file.endsWith('.handlebars')) continue;
    hb.registerPartial(`access/${file.replace(/\.handlebars$/, '')}`, fs.readFileSync(path.join(ACCESS_DIR, file), 'utf8'));
  }
};

module.exports = { registerAccessPartials };
