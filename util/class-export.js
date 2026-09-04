/**
 * Class Export Module
 * 
 * Provides class export functionality with support for multiple formats.
 * Currently supports: markdown, json
 */

const { pickClassProse } = require('./class-prose');
const { gearCategory } = require('./class-gear');

/**
 * Available export formats
 */
const EXPORT_FORMATS = {
  MARKDOWN: 'markdown',
  JSON: 'json',
};

/**
 * MIME types for each export format
 */
const FORMAT_MIME_TYPES = {
  [EXPORT_FORMATS.MARKDOWN]: 'text/markdown',
  [EXPORT_FORMATS.JSON]: 'application/json',
};

/**
 * File extensions for each export format
 */
const FORMAT_EXTENSIONS = {
  [EXPORT_FORMATS.MARKDOWN]: 'md',
  [EXPORT_FORMATS.JSON]: 'json',
};

/**
 * Sanitize filename by removing/replacing invalid characters
 */
const sanitizeFilename = (name) => {
  return name
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .trim();
};

/**
 * Capitalize first letter of a string
 */
const capitalize = (str) => {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
};

/**
 * One ability or gear item: everything the structured columns hold, since both
 * carry the same five-key contract (util/class-abilities.js, util/class-gear.js)
 * and an export that printed only name and description would lose the rest.
 */
const itemLines = (entry) => {
  const item = typeof entry === 'string' ? { name: entry } : entry;
  const quoted = (value) => `> ${String(value).replace(/\n/g, '\n> ')}`;
  const lines = [item.pronunciation
    ? `**${item.name}** *(pronounced: ${item.pronunciation})*`
    : `**${item.name}**`];

  if (item.description) {
    lines.push('', quoted(item.description));
  }
  if (item.paired_action) {
    lines.push('', `**Paired Action:** ${item.paired_action}`);
  }
  if (item.meters && item.meters.length > 0) {
    lines.push('');
    for (const meter of item.meters) {
      lines.push(`- **${meter.label}:** ${meter.value}`);
    }
  }
  if (item.notes && item.notes.length > 0) {
    lines.push('');
    for (const note of item.notes) {
      lines.push(`- ${note.text}`);
      for (const child of note.children || []) {
        lines.push(`  - ${child.text}`);
      }
    }
  }
  lines.push('');
  return lines;
};

/**
 * Export class to Markdown format
 */
const exportToMarkdown = (classData) => {
  const lines = [];
  
  // Header with name and edition
  lines.push(`# ${classData.name}`);
  lines.push('');
  lines.push(`**${capitalize(classData.rules_edition || 'unknown')}** ${classData.rules_version || ''} · **Status:** ${capitalize(classData.status || 'unknown')}`);
  lines.push('');
  
  // Class image at the top if available
  if (classData.image_url) {
    lines.push(`![${classData.name}](${classData.image_url})`);
    lines.push('');
  }
  
  lines.push('---');
  lines.push('');
  
  // Overview: the prose columns, in the source document's printed order.
  const overview = [];
  const prose = (value) => (typeof value === 'string' ? value.trim() : '');
  if (prose(classData.stat_line)) {
    overview.push(`**${prose(classData.stat_line)}**`, '');
  }
  if (prose(classData.stat_note)) {
    overview.push(prose(classData.stat_note), '');
  }
  if (prose(classData.quote)) {
    overview.push(`> ${prose(classData.quote).replace(/\n/g, '\n> ')}`);
    if (prose(classData.quote_source)) {
      overview.push('>', `> — ${prose(classData.quote_source)}`);
    }
    overview.push('');
  }
  for (const paragraph of ['overview', 'conduit_notes', 'grounding', 'examples_heading']) {
    if (prose(classData[paragraph])) {
      overview.push(prose(classData[paragraph]), '');
    }
  }
  if (Array.isArray(classData.examples) && classData.examples.length > 0) {
    for (const example of classData.examples) {
      overview.push(`- ${example}`);
    }
    overview.push('');
  }
  if (prose(classData.challenge_level)) {
    overview.push(`**Challenge Level:** ${prose(classData.challenge_level)}`, '');
  }
  if (prose(classData.designer)) {
    overview.push(`**Designer:** ${prose(classData.designer)}`, '');
  }
  if (overview.length > 0) {
    lines.push('## 📖 Overview');
    lines.push('');
    lines.push(...overview);
  }

  // Tips
  if (classData.tips && classData.tips.trim()) {
    lines.push('## 💡 Tips');
    lines.push('');
    lines.push(classData.tips.trim());
    lines.push('');
  }
  
  // Gear, split by the stored `category`. Position is only the fallback the
  // column was backfilled from (util/class-gear.js gearCategory), so an item
  // saved as Elective prints under Elective wherever it sits in the list.
  if (classData.gear && classData.gear.length > 0) {
    lines.push('## 🎒 Gear');
    lines.push('');

    const categorised = classData.gear.map((item, index) => ({
      item,
      category: gearCategory(typeof item === 'object' ? item.category : null, index),
    }));
    const column = (category) => categorised.filter((entry) => entry.category === category);

    for (const [heading, category] of [['Base Gear', 'default'], ['Elective Gear', 'elective']]) {
      const entries = column(category);
      if (entries.length === 0) continue;
      lines.push(`### ${heading}`);
      lines.push('');
      for (const entry of entries) {
        lines.push(...itemLines(entry.item));
      }
    }
  }
  
  // Abilities
  if (classData.abilities && classData.abilities.length > 0) {
    lines.push('## ⚔️ Abilities');
    lines.push('');
    for (const ability of classData.abilities) {
      lines.push(...itemLines(ability));
    }
  }
  
  // Footer with metadata
  lines.push('---');
  lines.push('');
  lines.push(`**Public:** ${classData.is_public ? 'Yes' : 'No'} · **Player Created:** ${classData.is_player_created ? 'Yes' : 'No'}`);
  lines.push('');
  lines.push(`*Exported from Agent Resources · ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}*`);
  
  return lines.join('\n');
};

// Both structured columns export in the contract shape a save writes, so a
// legacy two-field item and a freshly saved one export identically and an
// export -> import cycle cannot change the row. util/class-export.test.js pins
// the key set against util/class-import.js's schema rather than a literal list.
const exportAbility = (entry) => {
  const ability = typeof entry === 'string' ? { name: entry } : entry;
  const exported = {
    name: ability.name,
    description: ability.description ?? '',
    paired_action: ability.paired_action ?? '',
    meters: ability.meters ?? [],
    notes: ability.notes ?? [],
  };
  // Outside the contract: written through when the ability has one, never
  // fabricated -- the same rule util/class-abilities.js applies on save.
  if (ability.pronunciation) {
    exported.pronunciation = ability.pronunciation;
  }
  return exported;
};

const exportGearItem = (entry, index) => {
  const item = typeof entry === 'string' ? { name: entry } : entry;
  return {
    name: item.name,
    description: item.description ?? '',
    category: gearCategory(item.category, index),
    meters: item.meters ?? [],
    notes: item.notes ?? [],
  };
};

/**
 * Export class to JSON format
 */
const exportToJson = (classData) => {
  const exportData = {
    name: classData.name,
    ...pickClassProse(classData),
    rules_edition: classData.rules_edition,
    rules_version: classData.rules_version,
    status: classData.status,
    is_public: classData.is_public,
    is_player_created: classData.is_player_created,
    gear: (classData.gear || []).map(exportGearItem),
    abilities: (classData.abilities || []).map(exportAbility),
    image_url: classData.image_url || null,
    image_crop: classData.image_crop || null,
    teaser: classData.teaser || '',
    tips: classData.tips || '',
  };
  
  return JSON.stringify(exportData, null, 2);
};

/**
 * Export class to the specified format
 * 
 * @param {Object} classData - The class data to export
 * @param {string} format - The export format (use EXPORT_FORMATS constants)
 * @returns {Object} - { content, mimeType, filename }
 */
const exportClass = (classData, format = EXPORT_FORMATS.MARKDOWN) => {
  let content;
  
  switch (format) {
    case EXPORT_FORMATS.JSON:
      content = exportToJson(classData);
      break;
    case EXPORT_FORMATS.MARKDOWN:
    default:
      content = exportToMarkdown(classData);
      break;
  }
  
  const extension = FORMAT_EXTENSIONS[format] || 'txt';
  const mimeType = FORMAT_MIME_TYPES[format] || 'text/plain';
  const filename = `${sanitizeFilename(classData.name)}.${extension}`;
  
  return {
    content,
    mimeType,
    filename,
  };
};

/**
 * Get list of supported export formats
 */
const getSupportedFormats = () => {
  return Object.values(EXPORT_FORMATS);
};

module.exports = {
  exportClass,
  getSupportedFormats,
  EXPORT_FORMATS,
  FORMAT_MIME_TYPES,
  FORMAT_EXTENSIONS,
};

