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
 * Export character to Markdown format
 */
const exportToMarkdown = (character, options = {}) => {
  const lines = [];
  
  // Header
  lines.push(`# ${character.name}`);
  lines.push('');
  
  // Deceased status
  if (character.is_deceased) {
    lines.push('> ☠️ **DECEASED**');
    lines.push('');
  }
  
  // Basic Info
  lines.push('## Character Info');
  lines.push('');
  lines.push(`- **Class:** ${character.class || 'Unknown'}`);
  lines.push(`- **Level:** ${character.level || 1}`);
  lines.push(`- **Completed Missions:** ${character.completed_missions || 0}`);
  lines.push(`- **Commissary Reward:** ${character.commissary_reward || 0}`);
  lines.push('');
  
  // Personality Traits
  if (character.traits && character.traits.length > 0) {
    lines.push('## Personality');
    lines.push('');
    lines.push(character.traits.map(trait => `- ${trait}`).join('\n'));
    lines.push('');
  }
  
  // Stats
  lines.push('## Stats');
  lines.push('');
  lines.push('| Stat | Value |');
  lines.push('|------|-------|');
  for (const stat of statList) {
    const value = character[stat] || 0;
    lines.push(`| ${stat.charAt(0).toUpperCase() + stat.slice(1)} | ${formatStatValue(value)} |`);
  }
  lines.push('');
  
  // Class Abilities
  if (character.abilities && character.abilities.length > 0) {
    lines.push('## Class Abilities');
    lines.push('');
    for (const ability of character.abilities) {
      const name = typeof ability === 'string' ? ability : ability.name;
      const description = typeof ability === 'object' ? ability.description : null;
      lines.push(`### ${name}`);
      if (description) {
        lines.push('');
        lines.push(description);
      }
      lines.push('');
    }
  }
  
  // Ability Perks
  if (character.perks) {
    lines.push('## Ability Perks');
    lines.push('');
    lines.push(character.perks);
    lines.push('');
  }
  
  // Class Gear
  if (character.gear && character.gear.length > 0) {
    lines.push('## Class Gear');
    lines.push('');
    for (const item of character.gear) {
      const name = typeof item === 'string' ? item : item.name;
      const description = typeof item === 'object' ? item.description : null;
      lines.push(`### ${name}`);
      if (description) {
        lines.push('');
        lines.push(description);
      }
      lines.push('');
    }
  }
  
  // Additional Gear
  if (character.additional_gear) {
    lines.push('## Additional Gear');
    lines.push('');
    lines.push(character.additional_gear);
    lines.push('');
  }
  
  // Appearance
  if (character.appearance) {
    lines.push('## Appearance');
    lines.push('');
    lines.push(character.appearance);
    lines.push('');
  }
  
  // Background
  if (character.background) {
    lines.push('## Background');
    lines.push('');
    lines.push(character.background);
    lines.push('');
  }
  
  // Flavor
  if (character.flavor) {
    lines.push('## Flavor');
    lines.push('');
    lines.push(character.flavor);
    lines.push('');
  }
  
  // Ideas
  if (character.ideas) {
    lines.push('## Ideas');
    lines.push('');
    lines.push(character.ideas);
    lines.push('');
  }
  
  // Private Notes (only included if explicitly requested)
  if (options.includePrivateNotes && character.private_notes) {
    lines.push('## Private Notes');
    lines.push('');
    lines.push(character.private_notes);
    lines.push('');
  }
  
  // Image URL
  if (character.image_url) {
    lines.push('---');
    lines.push('');
    lines.push(`![${character.name}](${character.image_url})`);
    lines.push('');
  }
  
  // Footer
  lines.push('---');
  lines.push(`*Exported from Enclave*`);
  
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
