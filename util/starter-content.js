// Starter content granted to every new profile (see models/profile.js).
//
// This module is the single source of truth for those ids: the id assigned
// to a starter class row in util/seed-classes.js must be exactly the id the
// starter-unlock grant references, or every new profile hits a foreign-key
// violation and ends up with zero unlocked classes.

const STARTER_RULES_PDF_ID = 'a10948ac-5f78-481f-9e53-c582b59926cd'; // Enclave: Advent v1

// class name -> id granted by the starter unlock.
const STARTER_CLASS_UNLOCKS = {
  Gunslinger:  'b6ce893b-8207-4f89-abfc-a02ae0e9b65d',
  Illusionist: '018fcdba-39cf-4cc8-8f4d-92e2023719cf',
  Librarian:   'f0de4397-5e71-4ed6-a16a-26dc72c46801',
  Thane:       'aa0f9690-37a6-4784-9119-1b2117f798a7',
  Thunderbird: 'a605940b-f27f-45d8-af76-abda848b3e12',
  Wanderer:    'ebd55f52-9768-400a-94d6-392cd07e2b24',
};

module.exports = { STARTER_RULES_PDF_ID, STARTER_CLASS_UNLOCKS };
