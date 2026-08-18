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
    Witchhunter: '79721ac8-378e-4b3e-b1e3-8266689da89e',
  },
};

module.exports = { STARTER_RULES_PDF_ID, CORE_CLASS_UNLOCKS };
