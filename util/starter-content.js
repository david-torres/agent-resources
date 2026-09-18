// Core class rosters and starter content (see models/profile.js and
// models/class.js).
//
// This module is the single source of truth for these ids: the id assigned
// to a class row in util/seed-classes.js must be exactly the id the core
// roster references, or a book grant resolves to classes that do not exist.

const STARTER_RULES_PDF_ID = 'a10948ac-5f78-481f-9e53-c582b59926cd'; // Enclave: Advent v1

// ruleset -> class name -> id. Holding a rules PDF for a ruleset grants that
// ruleset's roster (util/book-classes.js). New profiles receive the Advent
// book, so the advent roster is also what a new account starts with.
const CORE_CLASS_UNLOCKS = {
  advent: {
    Gunslinger:  'b6ce893b-8207-4f89-abfc-a02ae0e9b65d',
    Illusionist: '018fcdba-39cf-4cc8-8f4d-92e2023719cf',
    Librarian:   'f0de4397-5e71-4ed6-a16a-26dc72c46801',
    Thane:       'aa0f9690-37a6-4784-9119-1b2117f798a7',
    Thunderbird: 'a605940b-f27f-45d8-af76-abda848b3e12',
    Wanderer:    'ebd55f52-9768-400a-94d6-392cd07e2b24',
  },
  aspirant: {
    Berserker:   '3c8f036f-06f0-4f72-9336-aa9c3fdd5541',
    Freerunner:  '42d39b55-7db1-49a1-a53b-b1cd5fc9bc47',
    Infiltrator: 'c687840c-a781-4d46-9570-b344e1b9be04',
    Samaritan:   'f0726c9b-bfaf-4c22-9318-75c50c8e3cbf',
    Vessel:      '3a863d9c-8454-4326-87ad-ed105fccbbd4',
    Witchfinder: '79721ac8-378e-4b3e-b1e3-8266689da89e',
  },
};

// The twelve rows scripts/load-prerelease-classes.mjs creates for
// ENCLAVE: Aspirant V1. Minted here rather than left to Postgres so the same
// class carries the same id in every environment -- which is the invariant
// util/core-roster.integration.test.js exists to check, and the one the
// 2026-08-07 deployment checklist had to reconcile by hand.
const ASPIRANT_V1_CLASS_IDS = {
  Gunslinger:  '3311fb69-4f9a-45f1-88d1-529bd8870a4c',
  Illusionist: '84543c7f-bb35-45e6-af5a-899b954bdc95',
  Librarian:   '3667c568-616f-4910-a89a-e576e197c862',
  Thane:       '0f8bbc56-90e7-4997-9356-a7aecaaecb21',
  Thunderbird: '4837502d-6595-44a9-8488-86e125a4bab3',
  Wanderer:    '00e706bd-fe35-478c-b817-3ce65c7ff91a',
  Berserker:   'cd56fcba-10b5-41af-9bbd-3c882377ac9d',
  Freerunner:  'c8b18cea-b8c9-4433-aa93-545eb28dcf66',
  Infiltrator: 'a8b0d13d-280b-48b1-b410-37b34bfc1a81',
  Samaritan:   'fa42bce0-431c-4d00-a9f4-a21a1be0e519',
  Vessel:      'e293cb3a-98b0-492c-bf32-6311413574e4',
  Witchfinder: '81bccc24-a7f3-4217-8bf8-de65d1ae4633',
};

module.exports = { STARTER_RULES_PDF_ID, CORE_CLASS_UNLOCKS, ASPIRANT_V1_CLASS_IDS };
