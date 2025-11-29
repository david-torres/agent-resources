/**
 * Character Export Module
 * 
 * Provides character export functionality with support for multiple formats.
 * Currently supports: markdown
 * Designed to easily add: json, pdf, html, etc.
 */

const { statList } = require('./enclave-consts');

/**
 * Available export formats
 */
const EXPORT_FORMATS = {
  MARKDOWN: 'markdown',
  JSON: 'json',
  // Future formats can be added here:
  // PDF: 'pdf',
  // HTML: 'html',
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
 * Format stat value as plus signs (e.g., 3 -> "+++")
 */
const formatStatValue = (value) => {
  if (!value || value <= 0) return '—';
  return '+'.repeat(value);
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
 * Export character to Markdown format
 */
const exportToMarkdown = (character, options = {}) => {
  const lines = [];
  
  // Header with name and class/level tagline
  lines.push(`# ${character.name}`);
  lines.push('');
  lines.push(`**${character.class || 'Unknown'}** · Level ${character.level || 1}`);
  lines.push('');
  
  // Deceased status callout
  if (character.is_deceased) {
    lines.push('> ☠️ **This character is deceased.**');
    lines.push('');
  }
  
  // Character image at the top if available
  if (character.image_url) {
    lines.push(`![${character.name}](${character.image_url})`);
    lines.push('');
  }
  
  // Personality Traits - displayed as inline tags
  if (character.traits && character.traits.length > 0) {
    const traitTags = character.traits.map(trait => `\`${capitalize(trait)}\``).join(' · ');
    lines.push(`🎭 **Personality:** ${traitTags}`);
    lines.push('');
  }
  
  lines.push('---');
  lines.push('');
  
  // Stats section with cleaner table
  lines.push('## 📊 Stats');
  lines.push('');
  
  // Group stats into rows of 3 for better readability
  const statsWithValues = statList.map(stat => ({
    name: capitalize(stat),
    value: formatStatValue(character[stat] || 0)
  }));
  
  lines.push('| Stat | Value | Stat | Value | Stat | Value |');
  lines.push('|:-----|:-----:|:-----|:-----:|:-----|:-----:|');
  
  for (let i = 0; i < statsWithValues.length; i += 3) {
    const row = [];
    for (let j = 0; j < 3; j++) {
      const stat = statsWithValues[i + j];
      if (stat) {
        row.push(`| ${stat.name} | ${stat.value} `);
      } else {
        row.push('| | ');
      }
    }
    lines.push(row.join('') + '|');
  }
  lines.push('');
  
  // Class Abilities
  if (character.abilities && character.abilities.length > 0) {
    lines.push('## ⚔️ Class Abilities');
    lines.push('');
    for (const ability of character.abilities) {
      const name = typeof ability === 'string' ? ability : ability.name;
      const description = typeof ability === 'object' ? ability.description : null;
      if (description) {
        lines.push(`**${name}**`);
        lines.push(`> ${description.replace(/\n/g, '\n> ')}`);
        lines.push('');
      } else {
        lines.push(`- **${name}**`);
      }
    }
    if (!character.abilities.some(a => typeof a === 'object' && a.description)) {
      lines.push('');
    }
  }
  
  // Ability Perks
  if (character.perks && character.perks.trim()) {
    lines.push('## ✨ Ability Perks');
    lines.push('');
    lines.push(character.perks.trim());
    lines.push('');
  }
  
  // Class Gear
  if (character.gear && character.gear.length > 0) {
    lines.push('## 🎒 Class Gear');
    lines.push('');
    for (const item of character.gear) {
      const name = typeof item === 'string' ? item : item.name;
      const description = typeof item === 'object' ? item.description : null;
      if (description) {
        lines.push(`**${name}**`);
        lines.push(`> ${description.replace(/\n/g, '\n> ')}`);
        lines.push('');
      } else {
        lines.push(`- **${name}**`);
      }
    }
    if (!character.gear.some(g => typeof g === 'object' && g.description)) {
      lines.push('');
    }
  }
  
  // Common Items
  if (character.common_items && character.common_items.length > 0) {
    lines.push('## 📦 Common Items');
    lines.push('');
    for (const item of character.common_items) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }
  
  // Additional Gear (deprecated but still exported if present)
  if (character.additional_gear && character.additional_gear.trim()) {
    lines.push('## 🗃️ Additional Gear');
    lines.push('');
    lines.push(character.additional_gear.trim());
    lines.push('');
  }
  
  lines.push('---');
  lines.push('');
  
  // Appearance
  if (character.appearance && character.appearance.trim()) {
    lines.push('## 👤 Appearance');
    lines.push('');
    lines.push(character.appearance.trim());
    lines.push('');
  }
  
  // Background
  if (character.background && character.background.trim()) {
    lines.push('## 📜 Background');
    lines.push('');
    lines.push(character.background.trim());
    lines.push('');
  }
  
  // Flavor
  if (character.flavor && character.flavor.trim()) {
    lines.push('## 🎲 Flavor');
    lines.push('');
    lines.push(character.flavor.trim());
    lines.push('');
  }
  
  // Ideas
  if (character.ideas && character.ideas.trim()) {
    lines.push('## 💡 Ideas');
    lines.push('');
    lines.push(character.ideas.trim());
    lines.push('');
  }
  
  // Private Notes (only included if explicitly requested)
  if (options.includePrivateNotes && character.private_notes && character.private_notes.trim()) {
    lines.push('## 🔒 Private Notes');
    lines.push('');
    lines.push(character.private_notes.trim());
    lines.push('');
  }
  
  // Footer with metadata
  lines.push('---');
  lines.push('');
  lines.push(`**Missions Completed:** ${character.completed_missions || 0} · **Commissary Reward:** ${character.commissary_reward || 0}`);
  lines.push('');
  lines.push(`*Exported from Agent Resources · ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}*`);
  
  return lines.join('\n');
};

/**
 * Export character to JSON format
 */
const exportToJson = (character, options = {}) => {
  const exportData = {
    name: character.name,
    class: character.class,
    level: character.level,
    completed_missions: character.completed_missions,
    commissary_reward: character.commissary_reward,
    is_deceased: character.is_deceased,
    traits: character.traits || [],
    stats: {},
    abilities: (character.abilities || []).map(a => 
      typeof a === 'string' ? { name: a } : { name: a.name, description: a.description }
    ),
    perks: character.perks || '',
    gear: (character.gear || []).map(g => 
      typeof g === 'string' ? { name: g } : { name: g.name, description: g.description }
    ),
    common_items: character.common_items || [],
    additional_gear: character.additional_gear || '',
    appearance: character.appearance || '',
    background: character.background || '',
    flavor: character.flavor || '',
    ideas: character.ideas || '',
    image_url: character.image_url || null,
  };
  
  // Add stats
  for (const stat of statList) {
    exportData.stats[stat] = character[stat] || 0;
  }
  
  // Include private notes only if requested
  if (options.includePrivateNotes) {
    exportData.private_notes = character.private_notes || '';
  }
  
  return JSON.stringify(exportData, null, 2);
};

/**
 * Export character to the specified format
 * 
 * @param {Object} character - The character data to export
 * @param {string} format - The export format (use EXPORT_FORMATS constants)
 * @param {Object} options - Export options
 * @param {boolean} options.includePrivateNotes - Whether to include private notes
 * @returns {Object} - { content, mimeType, filename }
 */
const exportCharacter = (character, format = EXPORT_FORMATS.MARKDOWN, options = {}) => {
  let content;
  
  switch (format) {
    case EXPORT_FORMATS.JSON:
      content = exportToJson(character, options);
      break;
    case EXPORT_FORMATS.MARKDOWN:
    default:
      content = exportToMarkdown(character, options);
      break;
  }
  
  const extension = FORMAT_EXTENSIONS[format] || 'txt';
  const mimeType = FORMAT_MIME_TYPES[format] || 'text/plain';
  const filename = `${sanitizeFilename(character.name)}.${extension}`;
  
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
  exportCharacter,
  getSupportedFormats,
  EXPORT_FORMATS,
  FORMAT_MIME_TYPES,
  FORMAT_EXTENSIONS,
};
