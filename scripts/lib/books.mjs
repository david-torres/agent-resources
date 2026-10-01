import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ASPIRANT_EXCLUSIVE_CLASS_IDS, ASPIRANT_V1_CLASS_IDS } from '../../util/starter-content.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = join(REPO_ROOT, 'docs', 'data');
// Extracted book content is never committed: it resolves from a gitignored
// folder (private-data/ by default, overridable for a non-standard checkout),
// never from docs/data alongside the committed remap.
const ARTIFACT_DIR = process.env.CLASS_DATA_DIR || join(REPO_ROOT, 'private-data');

// A book whose `section` is this writes each record's own section heading.
export const SECTION_FROM_RECORD = 'from-record';

// One book's ingestion in one place: where its artifact lives, what names it
// resolves under, and what the load is authorised to make visible.
//
// `section` is what `prerelease_section` a class is written with:
// SECTION_FROM_RECORD reads each record's own heading, a section name stamps
// every class, and null leaves the column out. A forking book names its fork ids in `mintedIds` and
// finds each parent either through the class-unlock roster (`forkParentWhere`
// null) or as the one row of the class's name matching those columns.
export const BOOKS = {
  prerelease: {
    key: 'prerelease',
    artifact: join(ARTIFACT_DIR, 'prerelease-classes-2026-08.json'),
    remap: join(DATA, 'prerelease-name-remap.json'),
    // The document renames this class; the catalogue still holds the old
    // spelling until a load lands. Resolution accepts both, so a second run
    // finds the row it renamed rather than creating another.
    aliases: { Witchfinder: 'Witchhunter' },
    publishedByLoad: ['Ardent', 'Offdriver', 'Squire', 'Drachentöter', 'Charlatan', 'Fiendslayer', 'Janissary'],
    contentFormat: 'advent',
    rulesEdition: null,
    // A pre-release class is released Advent-format content, recorded at the
    // latest Advent version.
    status: 'release',
    rulesVersion: 'v2',
    forks: false,
    section: SECTION_FROM_RECORD,
    // The pre-release book was given away, so its classes are free to play.
    freePlay: true,
    mintedIds: null,
    forkParentWhere: null
  },
  'aspirant-v1': {
    key: 'aspirant-v1',
    artifact: join(ARTIFACT_DIR, 'aspirant-v1-classes-2026-09.json'),
    // V1 introduces no name this catalogue already holds under a different
    // spelling, and it renames nothing: it only adds rows.
    remap: null,
    aliases: {},
    publishedByLoad: ['Gunslinger', 'Illusionist', 'Librarian', 'Thane', 'Thunderbird',
      'Wanderer', 'Berserker', 'Freerunner', 'Infiltrator', 'Samaritan', 'Vessel',
      'Witchfinder'],
    contentFormat: 'aspirant',
    rulesEdition: 'aspirant',
    // Released content, gated by owning the book rather than by status.
    status: 'release',
    // Version within the Aspirant edition; mechanics are resolved separately.
    rulesVersion: 'v1',
    forks: true,
    section: null,
    // The grant lives in the class-unlock roster; free play on top of it would
    // make the roster meaningless.
    freePlay: false,
    mintedIds: ASPIRANT_V1_CLASS_IDS,
    forkParentWhere: null
  },
  'aspirant-exclusives': {
    key: 'aspirant-exclusives',
    artifact: join(ARTIFACT_DIR, 'aspirant-exclusives-classes-2026-10.json'),
    remap: null,
    aliases: {},
    publishedByLoad: ['Ardent', 'Offdriver', 'Squire'],
    contentFormat: 'aspirant',
    rulesEdition: 'aspirant',
    status: 'release',
    rulesVersion: 'v1',
    forks: true,
    // The admin unlock dashboard grants only 'exclusive' classes, and these are
    // unlock-only.
    section: 'exclusive',
    freePlay: false,
    mintedIds: ASPIRANT_EXCLUSIVE_CLASS_IDS,
    // The pre-release load inserted these parents with Postgres-minted ids, so
    // no roster names them and their ids differ between environments.
    forkParentWhere: { content_format: 'advent', prerelease_section: 'exclusive', is_player_created: false }
  }
};

export const bookFor = (key) => {
  const book = BOOKS[key];
  if (!book) throw new Error(`unknown book: ${JSON.stringify(key)}`);
  return book;
};
