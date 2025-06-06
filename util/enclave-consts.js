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
  vitality: ['indulgent', 'fun-loving', 'greedy', 'optimistic'],
  might: ['forceful', 'aggressive', 'retaliatory', 'brave'],
  resilience: ['tough', 'blunt', 'no-nonsense', 'grim'],
  spirit: ['compassionate', 'warm', 'sentimental', 'giving'],
  arcane: ['ambitious', 'powerhungry', 'haughty', 'scheming'],
  will: ['self-controlled', 'serious', 'calm', 'principled'],
  sensory: ['alert', 'aloof', 'organized', 'wary'],
  reflex: ['smooth', 'ingratiating', 'easygoing', 'sly'],
  vigor: ['enthusiastic', 'gung-ho', 'extroverted', 'boisterous'],
  skill: ['confident', 'cocky', 'showoffish', 'cool'],
  intelligence: ['opinionated', 'articulate', 'pretentious', 'analytical'],
  luck: ['carefree', 'cheeky', 'whimsical', 'complacent']
};

const classGearList = {
  Beastmaster: [
    'Fearsome Visage',
    'Bullwhip',
    'Animal Crackers',
    'Sovereign Lion',
    'Diving Falcon',
    'Coiling Serpent'
  ],
  Berserker: [
    'Pelt Panoply',
    'Great Axe',
    'Spatha',
    'Warpaint',
    'Gaesa',
    'Beast Claws'
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
  Gunslinger: [
    'Duster',
    'Bandolier',
    'Revolver',
    'Sharps Rifle',
    'Coach Gun',
    'Saddled Horse'
  ],
  Greybeard: [
    'Feathered Hat',
    'Weathered Cloak',
    'Graven Staff',
    'Churchwarden Pipe',
    'Orbuclum',
    'Eye in the Sky'
  ],
  Illusionist: [
    'Wizarding Hat',
    'Smokebombs',
    'Folding Fan',
    'Billowing Cape',
    'Tome',
    'Handmirror'
  ],
  Infiltrator: [
    'Catsuit',
    'Stiletto',
    'Earpiece',
    'Time Bomb',
    'Skeleton Key',
    'Listening Bugs'
  ],
  Librarian: [
    'Scholarly Raiment',
    'Reading Glasses',
    'Bookbag',
    'Quill Pen',
    'Scanner',
    'Memos'
  ],
  Lithomancer: [
    'Huaraches',
    'Earthshapers',
    'Circling Stones',
    'Safety Goggles',
    'Rock Maul',
    'Prima Materia'
  ],
  Raubritter: [
    'Sumptuary Furs',
    'Morningstar',
    'Warchest',
    'Langes Messer',
    'Hand Cannon',
    'Knecht'
  ],
  Samaritan: [
    'Habit',
    'Asklepian',
    'Alms',
    'Wings of Mercy',
    'Guiding Light',
    'Innocence Shield'
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
  Vessel: [
    'Ceremonial Raiment',
    'Ritual Knife',
    'Alter Lights',
    'Deathmask',
    'Shadow Blade',
    'Star Crystal'
  ],
  Wanderer: [
    'Satchel',
    'Walking Stick',
    'Waypoints',
    'Fiddle',
    'Nostrum',
    'Map'
  ],
  Witchhunter: [
    'Watchcoat',
    'Capotain',
    'Ballestrino',
    'Eyepatch',
    'Aspergillum',
    'Firebrand'
  ],
};

const classAbilityList = {
  Beastmaster: [
    'Sic \'Em!',
    'Collar',
    'Lure Sigil'
  ],
  Berserker: [
    'Furor',
    'Warp Spasm',
    'Bloodlust'
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
  Gunslinger: [
    'Trickshot',
    'Standoff',
    'Shootout'
  ],
  Greybeard: [
    'Great & Terrible',
    'Winds of Change',
    'Mímisbrunnr'
  ],
  Illusionist: [
    'Phantasm',
    'Veneer',
    'Viewpoint'
  ],
  Infiltrator: [
    'Identity Theft',
    'Case the Joint',
    'Maximum Security'
  ],
  Librarian: [
    'Fun Fact',
    'Knowledge is Power',
    'Catalog'
  ],
  Lithomancer: [
    'Tremor Sense',
    'Geomorph',
    'Stoneskin'
  ],
  Raubritter: [
    'Aufruhr',
    'Opprobrium',
    'Unverwüstlich'
  ],
  Samaritan: [
    'Gifts in Kind',
    'A Good Cause',
    'Extol Virtue'
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
  Vessel: [
    'Insidious Whispers',
    'Embrace Darkness',
    'Fill the Void'
  ],
  Wanderer: [
    'Fork in the Road',
    'By the Wayside',
    'Familiar Face'
  ],
  Witchhunter: [
    'Cloud of Suspicion',
    'Omoriori',
    'Malleus Maleficarum'
  ],
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
  'Freerunner',
  'Infiltrator',
  'Samaritan',
  'Vessel',
  'Witchhunter'
];

const playerCreatedClassList = [
  'Beastmaster',
  'Bogatyr',
  'Greybeard',
  'Lithomancer',
  'Raubritter',
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
