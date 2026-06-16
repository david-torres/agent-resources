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

// Stat spreads applied by util/seed-classes.js. Sum is the number of
// pre-assigned stat points the class grants at level 1; the wizard adds
// personality-trait #3 on top and lets the user distribute the remainder.
// Player-created classes (not listed here) default to no pre-assignment.
// Stat spreads parsed from each class's seeded description (the "Class Stats:
// ++ X / + Y" line near the top of the class view). All add up to 3 total
// pluses; most are 2+1, a few are three singles. Player-created classes not
// listed here default to no pre-assignment.
const classStatSpread = {
  Beastmaster: { vitality: 1, sensory: 1, skill: 1 },
  Berserker:   { might: 2, resilience: 1 },
  Bogatyr:     { vitality: 1, might: 1, luck: 1 },
  Freerunner:  { vigor: 2, reflex: 1 },
  Gunslinger:  { skill: 2, sensory: 1 },
  Greybeard:   { vitality: 1, will: 1, intelligence: 1 },
  Illusionist: { sensory: 2, arcane: 1 },
  Infiltrator: { reflex: 2, intelligence: 1 },
  Librarian:   { intelligence: 2, spirit: 1 },
  Lithomancer: { resilience: 2, arcane: 1 },
  Raubritter:  { vitality: 1, resilience: 1, vigor: 1 },
  Samaritan:   { vitality: 2, spirit: 1 },
  Thane:       { resilience: 2, spirit: 1 },
  Thunderbird: { arcane: 2, vigor: 1 },
  Vessel:      { spirit: 2, will: 1 },
  Wanderer:    { luck: 2, vitality: 1 },
  Witchhunter: { will: 2, sensory: 1 }
};

const v1LevelingSequence = [2, 3, 4, 5, 6, 7, 8, 9, 10];
const v2LevelingSequence = [2, 2, 3, 3, 4, 4, 5, 5, 6];

// Merx awarded per successful real mission. Current editions are a flat 1
// across v1 and v2; future editions are expected to tier this by level or
// mission difficulty — when that lands, replace the constant with a function
// of (character, mission) and update util/character-derived.js accordingly.
const MERX_PER_MISSION_SUCCESS = 1;

// Number of on-class signature gear items character creation grants for free.
// On-class gear beyond this count costs merx like any other purchase.
const STARTING_ON_CLASS_GEAR_ALLOTMENT = 4;

// Common items available to every character during the wizard's gear step.
// Each entry has a name and a short markdown description. The wizard offers
// these on the right-hand "spend your 2 merx" list at 1 merx each. This is
// test/placeholder data — the full catalogue will move to a database table.
const commonItemList = [
  { name: 'Bedroll',         description: 'A simple roll of canvas and wool. Lets you sleep rough without worrying about rain or biting insects.' },
  { name: 'Rations (3 days)', description: 'Dried meat, hardtack, and salt. Enough to keep one person moving for three days of hard travel.' },
  { name: 'Flint & Steel',   description: 'Reliable fire-starting kit. Strikes in damp conditions where a match would fail.' },
  { name: 'Rope, 50 ft',     description: 'Hemp rope, strong enough to bear a loaded pack or a struggling climber.' },
  { name: 'Lantern & Oil',   description: 'A hooded tin lantern and a small flask of oil. Burns for about six hours per fill.' },
  { name: 'Healing Salve',   description: 'A pot of herbal salve. When applied to a wound, it soothes pain and keeps infection at bay.' },
  { name: 'Manacles',        description: 'Iron wrist restraints with a simple lock. Useful for escorting prisoners back to civilization.' },
  { name: 'Spyglass',        description: 'A collapsible brass telescope. Lets you make out details at several times normal sight distance.' },
  { name: 'Waterskin',       description: 'A stitched leather skin, treated on the inside to keep water from spoiling for a few days.' },
  { name: 'Chalk',           description: 'A fistful of white chalk. Handy for marking safe paths, leaving signals, or sketching quick maps.' },
  { name: 'Hooded Cloak',    description: 'A long, hooded cloak in muted colors. Passable as a traveler, ranger, or pilgrim.' },
  { name: 'Lockpicks',       description: 'A set of fine metal picks, well-oiled. Quality is good enough for everyday locks; vaults are another matter.' }
];

module.exports = {
  statList,
  personalityMap,
  adventClassList,
  aspirantPreviewClassList,
  playerCreatedClassList,
  classGearList,
  classAbilityList,
  classStatSpread,
  v1LevelingSequence,
  v2LevelingSequence,
  MERX_PER_MISSION_SUCCESS,
  STARTING_ON_CLASS_GEAR_ALLOTMENT,
  commonItemList
};
