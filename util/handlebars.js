const moment = require('moment-timezone');

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

const date_tz = function(datetime, format, timezone) {
  if (!datetime) return '';
  return moment.utc(datetime).tz(timezone).format(format);
}

module.exports = {
    times,
    date_tz
}