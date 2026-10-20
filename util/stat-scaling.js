// The Stat Scaling Table: what a character can do at each plus count of each
// Stat. Baseline through +++++ is ENCLAVE Advent V2 pp. 35–36; the three
// columns beyond are Aspirant V1 p. 4's Expanded Stat Scaling. Text is
// verbatim from the books.
//
// No edition parameter: Advent caps a Stat at +++++, so only Aspirant
// characters ever have a value the expanded columns describe.

const PLUS_LABELS = ['Baseline', '+', '++', '+++', '++++', '+++++', '+++ +++', '+++ + +++', '++++ ++++'];
const ADVENT_MAX = 5;

const line = (text) => ({ term: null, text });
const term = (t, text) => ({ term: t, text });

const TABLE = {
  might: {
    label: 'Might',
    cells: [
      [line('Lift your own bodyweight.')],
      [line('Crush an apple one-handed.')],
      [line('Rip a college textbook in half.')],
      [line('Lift one end of a car.')],
      [line('Overhead press an entire car.')],
      [line('Throw a car a dozen yards.')],
      [line('Stop a speeding car in its tracks.')],
      [line('Lift one end of an empty freight train boxcar.')],
      [line('Overhead press an empty freight train boxcar.')],
    ],
  },
  reflex: {
    label: 'Reflex',
    cells: [
      [line('Climb a rope.')],
      [line('Slowly cross a tightrope.')],
      [line('Backflip on a tightrope.')],
      [line('Quickly cram yourself into a square box a third your height.')],
      [line('Comfortably land a 3-story drop unscathed.')],
      [line('Walk in someone’s shadow, matching every movement, without being noticed.')],
      [line('Dodge a bullet that you see being fired at you.')],
      [term('Inconspicuous', 'Walk through an occupied checkpoint unnoticed.')],
      [line('Stand atop still water.')],
    ],
  },
  resilience: {
    label: 'Resilience',
    cells: [
      [line('Survive several minutes of severe bleeding.')],
      [line('Pop a dislocated shoulder back in without flinching.')],
      [line('Endure full-body immolation for over a minute.')],
      [line('Take a baseball bat straight to the chest with barely a bruise.')],
      [line('Survive a pistol shot to the skull without losing consciousness.')],
      [line('Grab a swinging sword without it even breaking skin.')],
      [line('Endure a point-blank grenade explosion with only moderate injuries and disorientation.')],
      [line('Get rammed by a speeding car with barely a bruise.')],
      [line('Take a high-caliber rifle shot to the skull without it even breaking the skin.')],
    ],
  },
  sensory: {
    label: 'Sensory',
    cells: [
      [line('20/20 vision.')],
      [line('Detect a subtle change in wind speed/direction.')],
      [line('Smell poison in a drink.')],
      [line('Hear someone’s breathing through a solid wall.')],
      [line('Count the number of people in a small crowd at a glance.')],
      [line('Pick out the heartbeat of someone buried alive.')],
      [line('Quickly locate a lone four-leaf clover within a large field.')],
      [line('Follow a person’s trail for miles from the scent of a single garment.')],
      [line('Echolocate with a bat-like precision, tracing even miniscule moving objects.')],
    ],
  },
  skill: {
    label: 'Skill',
    cells: [
      [line('Catch a thrown object one-handed.'), term('Expertise — Piano', 'Play a simple, two-handed piece.')],
      [line('Safely toss a knife to yourself without looking.'), term('Expertise — Wrestling', 'Armbar an untrained person who’s larger than you.')],
      [line('Balance a pyramid of filled wine glasses at a brisk walk.'), term('Expertise — Driving', 'Powerslide into a perfect parallel park.')],
      [line('Effortlessly hit a bullseye.'), term('Expertise — Painting', 'Produce a photorealistic portrait in minutes.')],
      [line('Catch a fly between two fingers without killing it.'), term('Expertise — Surgery', 'Perform an open-heart operation solo.')],
      [line('Cut a bullet mid-flight.'), term('Expertise — Lockpicking', 'Open a tumbler lock in seconds without any tools.')],
      [line('Beat a rhythm game on the first try with a perfect score.'), term('Expertise — Guitar', 'Finger-pick six different parts simultaneously across two different instruments.')],
      [line('Cut a flying grain of sand in half.'), term('Expertise — Tennis', 'Slice with enough spin to curve the ball in any direction like a frisbee.')],
      [line('Balance two needles, stacked point-to-point, on the tip of your finger.'), term('Expertise — Cardistry', 'Shuffle and stack four marked decks simultaneously, two per hand.')],
    ],
  },
  vigor: {
    label: 'Vigor',
    cells: [
      [line('Run up a three story staircase in under 20 seconds.'), term('Stamina', 'Drop a Threshold after a pilates session.')],
      [line('Keep pace with a casual cyclist.'), term('Stamina', 'Drop a Threshold after sprinting a mile.')],
      [line('Throw 60 full-power punches in a minute.'), term('Stamina', 'Drop a Threshold after jogging a marathon.')],
      [line('Keep pace with a horse.'), term('Stamina', 'Drop a Threshold after 10 minutes of max-intensity combat.')],
      [line('With a running start, leap clean across a four-lane street.'), term('Stamina', 'Drop a Threshold after sprinting a marathon.')],
      [line('Keep pace with a car on the highway.'), term('Stamina', 'Drop a Threshold after summiting a mountain at top speed.')],
      [line('Mop a gymnasium floor by hand in under a minute.'), term('Stamina', 'Drop a threshold after sprinting a marathon having not slept for a week.')],
      [line('Run across still water for several seconds.'), term('Stamina', 'Drop a threshold after sprinting a marathon while on the brink of starvation.')],
      [line('Keep pace with a speedboat while swimming.'), term('Stamina', 'Drop a threshold after completing an entire special forces boot camp in a single day.')],
    ],
  },
  arcane: {
    label: 'Arcane',
    note: 'Without Sacrifice',
    cells: [
      [term('Manifestation', 'Light a cigarette with a snap of the fingers.')],
      [term('Manifestation', 'Glow brightly.')],
      [term('Manifestation', 'Dictate to a pen while it autonomously transcribes your words.')],
      [term('Manifestation', 'Hurl a head-sized fireball.')],
      [term('Manifestation', 'Animate a suit of armor to briefly fight at your side.')],
      [term('Manifestation', 'Drain a target’s life through prolonged touch.')],
      [term('Manifestation', 'Enchant a sword to become temporarily indestructible.')],
      [term('Manifestation', 'Raise an entire graveyard as Shamblers.')],
      [term('Manifestation', 'Teleport between two deep shadows.')],
    ],
  },
  intelligence: {
    label: 'Intelligence',
    cells: [
      [term('Deduction', 'Confirm that a clean knife was recently used.'), term('Expertise — A Local Language', 'Know the name of that language and a basic greeting.')],
      [term('Deduction', 'Confirm that a fleeing suspect has doubled back when the trail goes cold.'), term('Expertise — Cartography', 'Decipher a strange map.')],
      [term('Deduction', 'Confirm a secret passage’s presence based on an untraceable breeze.'), term('Expertise — Computers', 'Hack a mainframe first try.')],
      [term('Deduction', 'Confirm that someone is a dentist by the way they hold a pen.'), term('Expertise — Entomology', 'Recite any fact about any local species of ant.')],
      [term('Deduction', 'Confirm a villain’s master plan based on the password to his computer.'), term('Expertise — Chemistry', 'Create a potent explosive out of pantry ingredients.')],
      [term('Deduction', 'Confirm the precise time and cause of a death from a single drop of blood.'), term('Expertise — Stock Trading', 'Quadruple an investment in minutes.')],
      [term('Deduction', 'Confirm a hidden enemy’s exact position and threat level based on the time of day.'), term('Expertise — Ballistics', 'Calculate a projectile’s precise firing arc, point of impact, and likely damage with a single glance.')],
      [term('Deduction', 'Confirm a missing person’s current location based on where they were last seen a month ago.'), term('Expertise — Anthropology', 'Learn the history of an isolated culture with no written records.')],
      [term('Deduction', 'Confirm the location, timing, and objective of a surprise attack based on a minor cultural artifact from the enemy’s homeland.'), term('Expertise — Board Games', 'Beat a modern supercomputer fair and square at any board game.')],
    ],
  },
  luck: {
    label: 'Luck',
    cells: [
      [term('Happenstance', 'Find an inconsequential object.')],
      [term('Happenstance', 'A harmful strike becomes a glancing blow.')],
      [term('Happenstance', 'Find a useful object convenient to hand.')],
      [term('Happenstance', 'An enemy improbably misses an easy killing blow.')],
      [term('Happenstance', 'A critical item happens to be left unattended in your presence.')],
      [term('Happenstance', 'Clean out a poker table without once needing to bluff.')],
      [term('Happenstance', 'An unassuming local you were kind to earlier bails you out when you need it most.')],
      [term('Happenstance', 'A 20-man firing squad with modern weapons all happen to miss, and none check to make sure you are actually dead.')],
      [term('Happenstance', 'A devastating nearby explosion happens to spare you alone out of everything in sight.')],
    ],
  },
  spirit: {
    label: 'Spirit',
    cells: [
      [line('See through a clumsy lie.'), term('Intuition', 'Confirm that someone is being sarcastic.')],
      [line('See fear in someone’s eyes.'), term('Intuition', 'Confirm that a mysterious stranger is a friend.')],
      [line('Pick out unspoken tension between two people in a group.'), term('Intuition', 'Confirm that great danger is imminent.')],
      [line('See past a carefully crafted facade.'), term('Intuition', 'Confirm the nature of an unknown magic.')],
      [line('Determine the sentimental value of an object.'), term('Intuition', 'Confirm a condemned man’s innocence despite all evidence to the contrary.')],
      [line('Get a sense of what recently happened in a room you enter.'), term('Intuition', 'Confirm a secret that not a single other soul knows.')],
      [term('Empathy', 'Get the gist of what a sleeping person is dreaming about.'), term('Intuition', 'Confirm when, where, and how someone will unexpectedly die.')],
      [term('Empathy', 'Decipher precisely what a daydreaming person is reminiscing about.'), term('Intuition', 'Confirm the presence and nature of a supernatural entity, force, god, or similar.')],
      [term('Empathy', 'Learn the full details of a past interaction without anyone involved ever mentioning it.'), term('Intuition', 'Confirm the presence, capacities, and intent of a completely unknown enemy.')],
    ],
  },
  vitality: {
    label: 'Vitality',
    cells: [
      [line('Get someone’s attention in a busy room.'), term('Heartening', 'Clear up a bruise.')],
      [line('Nonverbally hold someone’s interest.'), term('Heartening', 'Restore a Mid Cost’s worth of Stamina or Essence.')],
      [line('Draw focus of a crowd away from a scuffle.'), term('Heartening', 'Close up a deep cut.')],
      [line('Keep someone talking even as they try to kill you.'), term('Heartening', 'Knit a broken bone.')],
      [line('Tempt a bloodthirsty monster away from helpless prey.'), term('Heartening', 'Restore a full Threshold of Stamina or Essence.')],
      [line('Distract a regiment of trained soldiers from a battle at hand.'), term('Heartening', 'Reattach a severed limb (with imperfect recovery of function).')],
      [line('Render a modern surveillance system unable to identify anyone’s face but your own.'), term('Heartening', 'Staunch a terminal bleed and magically restore much of the lost blood.')],
      [line('Hold a permanent place in someone’s memory until the day they die.'), term('Heartening', 'Cure a terminal illness on the death bed.')],
      [line('Draw the attention of a god without necessarily doing anything to earn it.'), term('Heartening', 'Perfectly repair a traumatic brain injury with no loss of mental function.')],
    ],
  },
  will: {
    label: 'Will',
    cells: [
      [term('Essence', 'Drop a Threshold after two Mid Costs.'), term('Defiance', 'Skydive despite being scared to do so.')],
      [term('Essence', 'Drop a Threshold after seven Low Costs.'), term('Defiance', 'Become fully lucid for a few moments during Red Essence Exhaustion.')],
      [term('Essence', 'Drop a Threshold after three Mid Costs.'), term('Defiance', 'Briefly ignore the pain of a broken limb.')],
      [term('Essence', 'Drop a Threshold after two High Costs.'), term('Defiance', 'Remain conscious even after several minutes without air.')],
      [term('Essence', 'Drop a Threshold after five Mid Costs.'), term('Defiance', 'Lock eyes with a gorgon without turning to stone.')],
      [term('Essence', 'Drop a Threshold after three High Costs.'), term('Defiance', 'Safely handle a cursed artifact known to kill anyone who touches it.')],
      [term('Essence', 'Drop a Threshold after four High Costs.'), term('Defiance', 'Safely bathe in the corrosive blood of a hydra.')],
      [term('Essence', 'Drop a Threshold after a Low amount of Mid Costs.'), term('Defiance', 'Ignore the direct command of a mighty god.')],
      [term('Essence', 'Drop a Threshold after a High amount of Low Costs.'), term('Defiance', 'Refuse to die for a Low Duration.')],
    ],
  },
};

const entryFor = (stat, row, pluses) => ({
  stat,
  statLabel: row.label,
  note: row.note || null,
  pluses,
  label: PLUS_LABELS[pluses],
  lines: row.cells[pluses],
});

const statScaling = (stat, value) => {
  const row = TABLE[stat];
  if (!row || !Number.isInteger(value) || value < 0 || value >= row.cells.length) return null;
  return entryFor(stat, row, value);
};

const statScalingRow = (stat) => {
  const row = TABLE[stat];
  if (!row) return [];
  return row.cells.slice(0, ADVENT_MAX + 1).map((_, pluses) => entryFor(stat, row, pluses));
};

module.exports = { statScaling, statScalingRow, PLUS_LABELS };
