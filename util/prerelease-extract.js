const { statList } = require('./enclave-consts');

const parseStatLine = (line) => {
  const spread = {};
  for (const token of String(line).split(/[,/]/)) {
    const match = token.trim().match(/^(\++)\s*([A-Za-z]+)\*?$/);
    if (!match) continue;
    const stat = match[2].toLowerCase();
    if (!statList.includes(stat)) {
      throw new Error(`Unknown stat in stat line: ${match[2]}`);
    }
    spread[stat] = match[1].length;
  }
  return spread;
};

const round1 = (value) => Math.round(value * 10) / 10;

// Bands are derived per page rather than hardcoded so a page laid out
// slightly differently still resolves correctly.
const clusterBands = (xMins, tolerance = 6) => {
  const sorted = [...xMins].sort((a, b) => a - b);
  const bands = [];
  let run = [];
  for (const x of sorted) {
    if (run.length && x - run[0] > tolerance) {
      bands.push(round1(run.reduce((a, b) => a + b, 0) / run.length));
      run = [];
    }
    run.push(x);
  }
  if (run.length) bands.push(round1(run.reduce((a, b) => a + b, 0) / run.length));
  return bands;
};

const ROW_TOLERANCE = 3;

const pairMeters = (blocks) => {
  const [labelBand] = clusterBands(blocks.map(b => b.xMin), 20);
  const labels = blocks.filter(b => Math.abs(b.xMin - labelBand) <= 20);
  const values = blocks.filter(b => !labels.includes(b));
  return labels
    .sort((a, b) => a.yMin - b.yMin)
    .map((label) => {
      const value = values.find(v => Math.abs(v.yMin - label.yMin) <= ROW_TOLERANCE);
      if (!value) throw new Error(`Meter label with no value: ${label.text}`);
      return { label: label.text, value: value.text };
    });
};

// The glyph is followed by U+200B in the source PDF; both are furniture, and
// stripping them leaves the sentence itself untouched.
const stripBullet = (text) => text.replace(/^[❖➢]​?\s*/, '').trim();

const buildNoteTree = (bullets) => {
  const [topBand] = clusterBands(bullets.map(b => b.xMin), 10);
  const notes = [];
  for (const bullet of bullets) {
    const note = { text: stripBullet(bullet.text), children: [] };
    if (Math.abs(bullet.xMin - topBand) <= 10) {
      notes.push(note);
      continue;
    }
    if (!notes.length) throw new Error(`Sub-bullet with no parent: ${note.text}`);
    notes[notes.length - 1].children.push(note);
  }
  return notes;
};

module.exports = { parseStatLine, clusterBands, pairMeters, buildNoteTree };
