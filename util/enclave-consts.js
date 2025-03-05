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
    'Gaesa',
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
  Freerunner: [
    'Sportwear',
    'Sneakers',
    'Tonfa',
    'Grapple Gun',
    'Energy Drink',
    'Action Camera'
  ],
  Witchhunter: [
    'Watchcoat',
    'Capotain',
    'Ballestrino',
    'Eyepatch',
    'Aspergillum',
    'Firebrand'
  ],
  Lithomancer: [
    'Huaraches',
    'Earthshapers',
    'Circling Stones',
    'Safety Goggles',
    'Rock Maul',
    'Prima Materia'
  ]
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
  ],
  Freerunner: [
    'Derive',
    'Tag, You\'re It',
    'Hangtime'
  ],
  Witchhunter: [
    'Cloud of Suspicion',
    'Omoriori',
    'Malleus Maleficarum'
  ],
  Lithomancer: [
    'Tremor Sense',
    'Geomorph',
    'Stoneskin'
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
  'Vessel',
  'Freerunner',
  'Witchhunter'
];

const playerCreatedClassList = [
  'Bogatyr',
  'Lithomancer'
];

const v1LevelingSequence = [2, 3, 4, 5, 6, 7, 8, 9, 10];
const v2LevelingSequence = [2, 2, 3, 3, 4, 4, 5, 5, 6];

module.exports = {
  statList,
  personalityMap,
  adventClassList,
  aspirantPreviewClassList,
  playerCreatedClassList,
  classGearList,
  classAbilityList,
  v1LevelingSequence,
  v2LevelingSequence
};
