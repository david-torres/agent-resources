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
  Berserker: [
    'Pelt Panoply',
    'Great Axe',
    'Spatha',
    'Warpaint',
    'Beast Claws'
  ],
  Infiltrator: [
    'Catsuit',
    'Stiletto',
    'Earpiece',
    'Time Bomb',
    'Skeleton Key',
    'Listening Bugs'
  ],
  Vessel: [
    'Ceremonial Raiment',
    'Ritual Knife',
    'Alter Lights',
    'Deathmask',
    'Shadow Blade',
    'Star Crystal'
  ],
  Bogatyr: [
    'Bludgeon',
    'Vyshyvanka',
    'Spangenhelm',
    'Toolbox',
    'Earspoon',
    'Endless Tankard'
  ],
};

const classAbilityList = {
  Gunslinger: [
    'Trickshot',
    'Standoff',
    'Shootout'
  ],
  Illusionist: [
    'Phantasm',
    'Veneer',
    'Viewpoint'
  ],
  Librarian: [
    'Fun Fact',
    'Knowledge is Power',
    'Catalog'
  ],
  Thane: [
    'To Arms',
    'Shieldwall',
    'Gairethinx'
  ],
  Thunderbird: [
    'Storm Brewing',
    'Thunderclap',
    'Out of the Blue'
  ],
  Wanderer: [
    'Fork in the Road',
    'By the Wayside',
    'Familiar Face'
  ],
  Berserker: [
    'Furor',
    'Warp Spasm',
    'Bloodlust'
  ],
  Infiltrator: [
    'Identity Theft',
    'Case the Joint',
    'Maximum Security'
  ],
  Vessel: [
    'Insidious Whispers',
    'Embrace Darkness',
    'Fill the Void'
  ],
  Bogatyr: [
    'Friend in Need',
    'Samosek',
    'Trading Blows'
  ]
}

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

module.exports = {
  statList,
  personalityMap,
  adventClassList,
  aspirantPreviewClassList,
  playerCreatedClassList,
  classGearList,
  classAbilityList
};
