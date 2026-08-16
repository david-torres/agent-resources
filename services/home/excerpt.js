// News posts are markdown (pages.content). The homepage shows a one-line teaser,
// so strip the syntax to plain text rather than rendering and then stripping
// HTML — cheaper, and it keeps this module free of the markdown renderer.

const buildExcerpt = (markdown, maxLength = 160) => {
  if (typeof markdown !== 'string' || !markdown) return '';

  let text = markdown;

  // Apply stripping rules iteratively to handle syntax exposed by emphasis removal.
  // If emphasis stripping exposes heading syntax (like **~~###~~** → ###),
  // the heading rule can match on the next iteration.
  for (let iteration = 0; iteration < 5; iteration++) {
    const before = text;
    text = text
      .replace(/<[^>]+>/g, ' ')                // HTML tags
      .replace(/^\s*\[[^\]]+\]:\s*.+$/gm, '')  // reference-style link definitions
      .replace(/```[\s\S]*?```/g, ' ')         // fenced code blocks
      .replace(/`([^`]*)`/g, '$1')             // inline code
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')   // images
      .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')// reference-style links -> their text
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // inline links -> their text
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')      // headings (with space)
      .replace(/^\s*#{1,6}\s*$/gm, '')         // bare heading markers (exposed after emphasis stripping)
      .replace(/^\s{0,3}>\s?/gm, '')           // blockquotes
      .replace(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/gm, '') // horizontal rules
      .replace(/^\s*[-*+]\s+/gm, '')           // list bullets
      .replace(/^\s*\|(.+)\|\s*$/gm, (match, content) => {
        // Skip separator rows (all dashes, pipes, colons, spaces)
        if (/^[\s\-:|]*$/.test(content)) return ' ';
        // Extract cell text from table rows
        return content.split('|').map(cell => cell.trim()).filter(Boolean).join(' ') + ' ';
      })
      .replace(/\*\*([^*]+?)\*\*/g, '$1')      // **bold**
      .replace(/(?<![a-zA-Z0-9_])__([^ ][^_]*?[^ ]|[^ ])__(?![a-zA-Z0-9_])/g, '$1') // __bold__ (intraword guard)
      .replace(/(?<![a-zA-Z0-9_])\*([^ ][^*]*?[^ ]|[^ ])\*(?![a-zA-Z0-9_])/g, '$1') // *italic*
      .replace(/(?<![a-zA-Z0-9_])_([^ ][^_]*?[^ ]|[^ ])_(?![a-zA-Z0-9_])/g, '$1')   // _italic_
      .replace(/~~([^~]+?)~~/g, '$1');         // ~~strikethrough~~

    // Stop iterating if nothing changed
    if (text === before) break;
  }

  // Final whitespace normalization
  text = text.replace(/\s+/g, ' ').trim();

  if (text.length <= maxLength) return text;

  const clipped = text.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${(lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
};

module.exports = { buildExcerpt };
