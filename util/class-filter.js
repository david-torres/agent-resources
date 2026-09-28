// Filter character-form class option lists down to the user's unlocked set,
// matching by class id (NOT name — edition forks share names, and a v1
// unlock must not leak into another edition's fork).

const filterClassListsByIds = (lists, allowedIds) => {
  const filterArr = arr => (Array.isArray(arr) ? arr.filter(c => allowedIds.has(c.id)) : []);
  const advent = filterArr(lists.advent);
  const aspirant = filterArr(lists.aspirant);
  const pcc = filterArr(lists.pcc);
  return { advent, aspirant, pcc };
};

// The one released/PCC rule (spec: docs/superpowers/specs/
// 2026-08-17-class-list-partition-design.md): a PCC belongs in the PCC
// section only until it is released — on release it graduates into the
// official/released section.
const isUnreleasedPcc = (cls) => !!(cls && cls.is_player_created && cls.status !== 'release');

// Split a profile's public classes into the two sections shown on the profile
// view. A PCC that has been released (status='release') has been incorporated
// into the game, so it graduates into the official "released" section and drops
// out of the PCC section — no class appears in both.
const partitionProfileClasses = (classes) => {
  const list = Array.isArray(classes) ? classes : [];
  const released = [];
  const pcc = [];
  for (const cls of list) {
    (isUnreleasedPcc(cls) ? pcc : released).push(cls);
  }
  return { released, pcc };
};

// Same rule applied to the version-grouped shape from class-list-grouping.js:
// partitions an array of { primary, previous } groups by each group's primary.
const partitionClassGroups = (groups) => {
  const list = Array.isArray(groups) ? groups : [];
  const released = [];
  const pcc = [];
  for (const group of list) {
    (isUnreleasedPcc(group && group.primary) ? pcc : released).push(group);
  }
  return { released, pcc };
};

// The /classes catalog's four sections, decided per version group by its
// primary and checked in this order. Pre-release comes first because it must
// win over book ownership: the Aspirant book's roster grants the six
// pre-release aspirant-section classes (util/starter-content.js). Artwork is
// release content and appears only for released classes covered by a book the
// viewer owns; the other sections stay art-free (views/classes.handlebars).
const partitionClassCatalog = (groups, bookClassIds = new Set()) => {
  const list = Array.isArray(groups) ? groups : [];
  const ownedReleases = [];
  const otherReleases = [];
  const prerelease = [];
  const pcc = [];
  for (const group of list) {
    const cls = group && group.primary;
    if (cls?.prerelease_section) prerelease.push(group);
    else if (isUnreleasedPcc(cls)) pcc.push(group);
    else if (bookClassIds.has(cls?.id)) ownedReleases.push(group);
    else otherReleases.push(group);
  }
  return { ownedReleases, otherReleases, prerelease, pcc };
};

const OWNED_EDITIONS = ['advent', 'aspirant'];

// Narrow the owned-release groups to one rules edition. An unknown or unowned
// requested edition falls back to the first edition the viewer owns.
const splitOwnedByEdition = (groups, requested) => {
  const list = Array.isArray(groups) ? groups : [];
  const byEdition = Object.fromEntries(OWNED_EDITIONS.map(e => [e, []]));
  for (const group of list) {
    const edition = group?.primary?.rules_edition || 'advent';
    if (byEdition[edition]) byEdition[edition].push(group);
  }
  const editions = OWNED_EDITIONS.filter(e => byEdition[e].length > 0);
  const edition = editions.includes(requested) ? requested : (editions[0] || null);
  return { edition, groups: edition ? byEdition[edition] : [], editions };
};

const CATALOG_FILTER_KEYS = ['rules_edition', 'rules_version', 'status', 'is_player_created'];

const ownedToggleLinks = (query = {}) => {
  const linkFor = (edition) => {
    const params = new URLSearchParams();
    for (const key of CATALOG_FILTER_KEYS) {
      if (query[key]) params.set(key, query[key]);
    }
    params.set('yours', edition);
    return `/classes?${params.toString()}`;
  };
  return { advent: linkFor('advent'), aspirant: linkFor('aspirant') };
};

const CHALLENGE_LEVELS = ['Low', 'Mid', 'High'];

const DIFFICULTY_BUCKETS = [
  ...CHALLENGE_LEVELS.map(level => ({ level, label: `${level} Challenge` })),
  { level: 'unrated', label: 'Unrated' }
];

const byName = (a, b) =>
  (a?.primary?.name || '').localeCompare(b?.primary?.name || '', undefined, { sensitivity: 'base' });

const bucketLevel = (group) => {
  const level = group?.primary?.challenge_level;
  return CHALLENGE_LEVELS.includes(level) ? level : 'unrated';
};

const groupByDifficulty = (groups) => {
  if (!Array.isArray(groups)) return [];
  return DIFFICULTY_BUCKETS
    .map(({ level, label }) => ({
      level,
      label,
      groups: groups.filter(g => bucketLevel(g) === level).sort(byName)
    }))
    .filter(b => b.groups.length > 0);
};

module.exports = {
  filterClassListsByIds,
  isUnreleasedPcc,
  partitionProfileClasses,
  partitionClassGroups,
  partitionClassCatalog,
  splitOwnedByEdition,
  ownedToggleLinks,
  groupByDifficulty
};
