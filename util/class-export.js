/**
 * Class Export Module
 * 
 * Provides class export functionality with support for multiple formats.
 * Currently supports: markdown, json
 */

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
  
  // Description
  if (classData.description && classData.description.trim()) {
    lines.push('## 📖 Description');
    lines.push('');
    lines.push(classData.description.trim());
    lines.push('');
  }
  
  // Gear
  if (classData.gear && classData.gear.length > 0) {
    lines.push('## 🎒 Gear');
    lines.push('');
    
    // Separate base gear (first 3) and elective gear (last 3)
    const baseGear = classData.gear.slice(0, 3);
    const electiveGear = classData.gear.slice(3, 6);
    
    if (baseGear.length > 0) {
      lines.push('### Base Gear');
      lines.push('');
      for (const item of baseGear) {
        const name = typeof item === 'string' ? item : item.name;
        const description = typeof item === 'object' ? item.description : null;
        lines.push(`**${name}**`);
        if (description) {
          lines.push('');
          lines.push(`> ${description.replace(/\n/g, '\n> ')}`);
        }
        lines.push('');
      }
    }
    
    if (electiveGear.length > 0) {
      lines.push('### Elective Gear');
      lines.push('');
      for (const item of electiveGear) {
        const name = typeof item === 'string' ? item : item.name;
        const description = typeof item === 'object' ? item.description : null;
        lines.push(`**${name}**`);
        if (description) {
          lines.push('');
          lines.push(`> ${description.replace(/\n/g, '\n> ')}`);
        }
        lines.push('');
      }
    }
  }
  
  // Abilities
  if (classData.abilities && classData.abilities.length > 0) {
    lines.push('## ⚔️ Abilities');
    lines.push('');
    for (const ability of classData.abilities) {
      const name = typeof ability === 'string' ? ability : ability.name;
      const description = typeof ability === 'object' ? ability.description : null;
      lines.push(`**${name}**`);
      if (description) {
        lines.push('');
        lines.push(`> ${description.replace(/\n/g, '\n> ')}`);
      }
      lines.push('');
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

/**
 * Export class to JSON format
 */
const exportToJson = (classData) => {
  const exportData = {
    name: classData.name,
    description: classData.description || '',
    rules_edition: classData.rules_edition,
    rules_version: classData.rules_version,
    status: classData.status,
    is_public: classData.is_public,
    is_player_created: classData.is_player_created,
    gear: (classData.gear || []).map(g => 
      typeof g === 'string' ? { name: g } : { name: g.name, description: g.description }
    ),
    abilities: (classData.abilities || []).map(a => 
      typeof a === 'string' ? { name: a } : { name: a.name, description: a.description }
    ),
    image_url: classData.image_url || null,
    image_crop: classData.image_crop || null,
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

