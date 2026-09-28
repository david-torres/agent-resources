const moment = require('moment-timezone');
const { CORE_CLASS_UNLOCKS } = require('../../util/starter-content');

const DAY_MS = 24 * 60 * 60 * 1000;
const URGENT_DAYS = 7;
const EDITIONS = Object.keys(CORE_CLASS_UNLOCKS);

const latest = (isoValues) => isoValues.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));

const knownZone = (timeZone) => (timeZone && moment.tz.zone(timeZone) ? timeZone : 'UTC');

const statusFor = (expiries, now, timeZone) => {
  if (expiries.length === 0) return { state: 'none' };
  if (expiries.some(value => value == null)) return { state: 'owned' };
  const active = expiries.filter(value => Date.parse(value) > now.getTime());
  if (active.length === 0) return { state: 'expired', endedAt: latest(expiries) };

  const endsAt = latest(active);
  const daysLeft = Math.ceil((Date.parse(endsAt) - now.getTime()) / DAY_MS);
  const zone = knownZone(timeZone);
  return {
    state: 'trial',
    endsAt,
    daysLeft,
    urgent: daysLeft <= URGENT_DAYS,
    endsToday: moment.utc(endsAt).tz(zone).isSame(moment.utc(now).tz(zone), 'day')
  };
};

// There is no trial flag: a trial is a core-book grant with an expiry, and a
// permanent grant for the same edition (a redeemed code) outranks it.
const resolveEditionStatus = (grants, now, { timeZone = null } = {}) => {
  const expiriesByEdition = Object.fromEntries(EDITIONS.map(edition => [edition, []]));
  for (const grant of grants || []) {
    const bucket = expiriesByEdition[grant?.rules_edition];
    if (bucket) bucket.push(grant.expires_at ?? null);
  }
  return Object.fromEntries(
    EDITIONS.map(edition => [edition, statusFor(expiriesByEdition[edition], now, timeZone)])
  );
};

const isLockedStatus = (status) => status?.state === 'expired' || status?.state === 'none';

module.exports = { resolveEditionStatus, isLockedStatus, URGENT_DAYS };
