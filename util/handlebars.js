const moment = require('moment-timezone');
const { google, outlook, office365, yahoo, ics } = require("calendar-link");

// N times helper, usage: {{#times 5}}<div>{{index}}</div>{{/times}}
// https://stackoverflow.com/a/41463316
const times = function (n, block) {
  var accum = '';
  for (var i = 0; i < n; ++i) {
    block.data.index = i;
    block.data.first = i === 0;
    block.data.last = i === (n - 1);
    accum += block.fn(this);
  }
  return accum;
};

const date_tz = function (datetime, format, timezone) {
  if (!datetime) return '';
  if (timezone === 'local') timezone = moment.tz.guess();
  return moment.utc(datetime).tz(timezone).format(format);
}

const calendar_link = function (platform, start, title, description) {
  const end = moment(start).add(3, 'hour').toDate();
  const eventData = {
    start,
    end,
    title,
    description
  };

  switch (platform) {
    case 'google':
      return google(eventData);
    case 'outlook':
      return outlook(eventData);
    case 'office365':
      return office365(eventData);
    case 'yahoo':
      return yahoo(eventData);
    case 'ics':
      return ics(eventData);
  }
  return false;
}

module.exports = {
  times,
  date_tz,
  calendar_link
}
