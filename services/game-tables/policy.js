// Pure rules for game tables: input validation and what a viewer may do.
// capabilitiesFor mirrors the RLS in
// supabase/migrations/20261009000000_game_tables.sql so the page offers only
// what the database will accept; the database stays the final authority.
const { statList } = require('../../util/enclave-consts');

const TABLE_NAME_MAX = 80;
const GUEST_NAME_MAX = 60;
const GUEST_CLASS_MAX = 60;
const GUEST_STAT_MAX = 5;

const pickStats = (source = {}) =>
  Object.fromEntries(statList.map((stat) => [stat, Number(source?.[stat]) || 0]));

const normalizeTableName = (raw) => {
  const name = String(raw ?? '').trim();
  if (!name) return { error: 'Give the table a name.' };
  if (name.length > TABLE_NAME_MAX) return { error: `Keep the table name to ${TABLE_NAME_MAX} characters.` };
  return { name };
};

const normalizeGuestInput = (body = {}) => {
  const errors = [];
  const name = String(body.name ?? '').trim();
  if (!name) errors.push('Give the character a name.');
  else if (name.length > GUEST_NAME_MAX) errors.push(`Keep the name to ${GUEST_NAME_MAX} characters.`);

  const classLabel = String(body.class_label ?? '').trim();
  if (classLabel.length > GUEST_CLASS_MAX) errors.push(`Keep the class to ${GUEST_CLASS_MAX} characters.`);

  const stats = {};
  const badStats = [];
  for (const stat of statList) {
    const raw = body[stat];
    const value = raw === undefined || raw === '' ? 0 : Number(raw);
    if (Number.isInteger(value) && value >= 0 && value <= GUEST_STAT_MAX) stats[stat] = value;
    else badStats.push(stat);
  }
  if (badStats.length) errors.push(`Stats must be whole numbers from 0 to ${GUEST_STAT_MAX}: ${badStats.join(', ')}.`);

  if (errors.length) return { errors };
  return { data: { guest_name: name, guest_class_label: classLabel || null, guest_stats: stats } };
};

const toDisplayMember = (row, viewerProfileId) => {
  if (row.character) {
    const c = row.character;
    return {
      memberId: row.id,
      id: c.id,
      isGuest: false,
      ownerId: c.creator_id,
      name: c.name,
      class: c.class,
      level: c.level,
      image_url: c.image_url,
      is_public: c.is_public,
      is_deceased: c.is_deceased,
      fromLfg: Boolean(row.lfg_join_request_id),
      canViewDetails: c.is_public || (Boolean(viewerProfileId) && c.creator_id === viewerProfileId),
      ...pickStats(c),
    };
  }
  return {
    memberId: row.id,
    id: row.id,
    isGuest: true,
    ownerId: null,
    name: row.guest_name,
    class: row.guest_class_label,
    level: null,
    image_url: null,
    is_public: true,
    is_deceased: false,
    fromLfg: false,
    canViewDetails: false,
    ...pickStats(row.guest_stats),
  };
};

const capabilitiesFor = (table, actor) => {
  const profileId = actor?.profileId || null;
  const isAdmin = actor?.role === 'admin';
  const isCreator = isAdmin || (Boolean(profileId) && table.creator_id === profileId);
  const canManage = isCreator || (Boolean(profileId) && table.conduit_id === profileId);
  const isConduit = isAdmin || (Boolean(profileId) && table.conduit_id === profileId);
  return { signedIn: Boolean(profileId), isCreator, canManage, isConduit };
};

module.exports = { normalizeGuestInput, normalizeTableName, toDisplayMember, capabilitiesFor, TABLE_NAME_MAX };
