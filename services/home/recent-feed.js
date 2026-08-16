const moment = require('moment-timezone');

// The homepage shows characters, mission logs, and classes in one list, so all
// three collapse to a single shape here rather than each template growing its
// own per-type branches.
//
// meta is a finished display string. Mission dates format in UTC: the column is
// day-granularity in practice, and a fixed zone keeps this module pure and its
// tests deterministic.

const capitalize = (value) => {
  if (typeof value !== 'string' || !value) return '';
  return value[0].toUpperCase() + value.slice(1);
};

const BUILDERS = {
  character: (row) => ({
    href: `/characters/${row.id}`,
    meta: `Level ${row.level} ${row.class}`
  }),
  mission: (row) => ({
    href: `/missions/${row.id}`,
    meta: `${capitalize(row.outcome)} · ${moment.utc(row.date).format('ll')}`
  }),
  class: (row) => ({
    href: `/classes/${row.id}`,
    meta: `${capitalize(row.status)} · ${capitalize(row.rules_edition)}`
  })
};

const toFeedItem = (type, row) => {
  const build = BUILDERS[type];
  if (!build || !row) return null;
  const { href, meta } = build(row);
  return {
    type,
    id: row.id,
    name: row.name,
    href,
    meta,
    updated_at: row.updated_at
  };
};

const mergeRecent = (groups, limit) => (groups || [])
  .filter(Array.isArray)
  .flat()
  .filter(Boolean)
  .sort((a, b) => {
    // moment.utc, not Date.parse: characters/missions are timestamptz and
    // serialize with an offset, but classes.updated_at is a plain
    // `timestamp` (no offset) -- Date.parse treats an offset-less
    // date-time as LOCAL time, so on a non-UTC server class rows would
    // shift by the server's UTC offset and sort out of step with what
    // {{time_ago}} (which uses moment.utc) renders.
    const delta = moment.utc(b.updated_at).valueOf() - moment.utc(a.updated_at).valueOf();
    if (delta !== 0) return delta;
    return String(a.name).localeCompare(String(b.name));
  })
  .slice(0, limit);

module.exports = { toFeedItem, mergeRecent };
