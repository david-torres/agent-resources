const statList = [
  'vitality',
  'might',
  'resilience',
  'spirit',
  'arcane',
  'will',
  'sensory',
  'reflex',
  'vigor',
  'skill',
  'intelligence',
  'luck'
];

const personalityMap = {
  vitality: 'indulgent',
  might: 'forceful',
  resilience: 'tough',
  spirit: 'compassionate',
  arcane: 'ambitious',
  will: 'self-controlled',
  sensory: 'alert',
  reflex: 'smooth',
  vigor: 'enthusiastic',
  skill: 'confident',
  intelligence: 'opinionated',
  luck: 'carefree'
};

const classGearList = {
  Gunslinger: [
    'Duster',
    'Bandolier',
    'Revolver',
    'Sharps Rifle',
    'Coach Gun',
    'Saddled Horse'
  ],
  Illusionist: [
    'Wizarding Hat',
    'Smokebombs',
    'Folding Fan',
    'Billowing Cape',
    'Tome',
    'Handmirror'
  ],
  Librarian: [
    'Scholarly Raiment',
    'Reading Glasses',
    'Bookbag',
    'Quill Pen',
    'Scanner',
    'Memos'
  ],
  Thane: [
    'Heavy Panoply',
    'Mantle',
    'Bastard Sword',
    'Halfpike & Kiteshield',
    'Banner',
    'Barded Warhorse'
  ],
  Thunderbird: [
    'Feathered Cloak',
    'Talaria',
    'Thunderhammer',
    'Heroic Cuirass',
    'Lightning Bolts',
    'Ceremonial Drum'
  ],
  Wanderer: [
    'Satchel',
    'Walking Stick',
    'Waypoints',
    'Fiddle',
    'Nostrum',
    'Map'
  ],
  // Berserker: [
  //   'Axe',
  //   'Armor',
  //   'Helmet',
  //   'Boots',
  //   'Belt'
  // ],
  // Infiltrator: [
  //   'Dagger',
  //   'Crossbow',
  //   'Cloak',
  //   'Mask',
  //   'Boots'
  // ],
  // Vessel: [
  //   'Mace',
  //   'Armor',
  //   'Helmet',
  //   'Boots',
  //   'Belt'
  // ],
  // Bogatyr: [
  //   'Sword',
  //   'Shield',
  //   'Armor',
  //   'Helmet',
  //   'Boots'
  // ],
};

const adventClassList = [
  'Gunslinger',
  'Illusionist',
  'Librarian',
  'Thane',
  'Thunderbird',
  'Wanderer'
];

const aspirantPreviewClassList = [
  'Berserker',
  'Infiltrator',
  'Vessel'
];

const playerCreatedClassList = [
  'Battery',
  'Bogatyr',
  'Inventor',
  'Jinx',
  'Lithomancer',
  'Ratcatcher',
  'Shōnen'
];

module.exports = { statList, personalityMap, adventClassList, aspirantPreviewClassList, playerCreatedClassList, classGearList };
