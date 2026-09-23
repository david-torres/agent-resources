import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'data');

// One book's ingestion in one place: where its artifact lives, what names it
// resolves under, and what the load is authorised to make visible.
export const BOOKS = {
  prerelease: {
    key: 'prerelease',
    artifact: join(DATA, 'prerelease-classes-2026-08.json'),
    remap: join(DATA, 'prerelease-name-remap.json'),
    // The document renames this class; the catalogue still holds the old
    // spelling until a load lands. Resolution accepts both, so a second run
    // finds the row it renamed rather than creating another.
    aliases: { Witchfinder: 'Witchhunter' },
    publishedByLoad: ['Ardent', 'Offdriver', 'Squire', 'Drachentöter', 'Charlatan'],
    contentFormat: 'advent',
    rulesEdition: null,
    // A pre-release class is released Advent-format content, recorded at the
    // latest Advent version.
    status: 'release',
    rulesVersion: 'v2',
    forks: false
  },
  'aspirant-v1': {
    key: 'aspirant-v1',
    artifact: join(DATA, 'aspirant-v1-classes-2026-09.json'),
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
    // Advent's v1/v2 are character-rules versions; a class in the Aspirant
    // format does not advance them.
    rulesVersion: 'v1',
    forks: true
  }
};

export const bookFor = (key) => {
  const book = BOOKS[key];
  if (!book) throw new Error(`unknown book: ${JSON.stringify(key)}`);
  return book;
};
