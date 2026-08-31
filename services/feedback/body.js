// Builds the Markdown for an issue filed from the in-app reporter.
//
// Every value that reaches here originated in a browser form, so the two
// hazards this module exists to contain are (1) a report body that pings
// people on GitHub and (2) user text that escapes the code fence it was
// meant to sit inside.
const BUG_LABEL = 'bug';
const FEATURE_LABEL = 'enhancement';

// GitHub stops resolving a mention when an HTML comment splits the sigil from
// the name, and renders nothing extra. Applied to every user-authored string
// so a report cannot notify (or link an issue to) anyone by accident.
const defuseMentions = (value) => String(value)
  .replace(/@(?=[A-Za-z0-9-])/g, '@<!---->')
  .replace(/#(?=\d)/g, '#<!---->');

// A fence has to be longer than the longest backtick run inside it, or the
// user's own ``` ends the block early and the rest of their text renders as
// Markdown.
const fenceFor = (content) => {
  const longest = (String(content).match(/`+/g) || []).reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
};

const fenced = (content, language = '') => {
  const fence = fenceFor(content);
  return `${fence}${language}\n${content}\n${fence}`;
};

const buildIssueTitle = ({ kind, title }) => `[${kind === 'bug' ? 'Bug' : 'Feature'}] ${title}`;

const labelsFor = ({ kind }) => [kind === 'bug' ? BUG_LABEL : FEATURE_LABEL];

const browserInfoTable = (info) => {
  const rows = Object.entries(info).map(([key, value]) => `| ${key} | ${defuseMentions(value)} |`);
  return ['| Field | Value |', '| --- | --- |', ...rows].join('\n');
};

// Console output goes in a fence rather than a table: it is the one section
// where line breaks and punctuation carry meaning.
const consoleBlock = (entries) => {
  const text = entries
    .map((entry) => `[${entry.at || '—'}] ${entry.level.toUpperCase()}: ${entry.message}`)
    .join('\n');
  return fenced(text);
};

const details = (summary, content) => `<details>\n<summary>${summary}</summary>\n\n${content}\n\n</details>`;

/**
 * @param {object} report Normalized report (services/feedback/input.js) plus
 *   the reporter identity and, when one was uploaded, `screenshotUrl`.
 * @returns {string} Markdown issue body.
 */
const buildIssueBody = (report) => {
  const {
    kind,
    description,
    pageUrl,
    browserInfo,
    consoleLog,
    screenshotUrl,
    screenshotFailed,
    reporter,
    submittedAt
  } = report;

  const sections = [];

  sections.push(`### ${kind === 'bug' ? 'What happened' : 'What would you like'}\n\n${defuseMentions(description)}`);

  const context = [];
  if (reporter?.name) context.push(`- **Reported by:** ${defuseMentions(reporter.name)}`);
  if (reporter?.profileId) context.push(`- **Profile:** \`${reporter.profileId}\``);
  if (pageUrl) context.push(`- **Page:** ${defuseMentions(pageUrl)}`);
  context.push(`- **Submitted:** ${submittedAt || new Date().toISOString()}`);
  sections.push(`### Context\n\n${context.join('\n')}`);

  if (screenshotUrl) {
    sections.push(`### Screenshot\n\n![Screenshot supplied by the reporter](${screenshotUrl})`);
  } else if (screenshotFailed) {
    sections.push('### Screenshot\n\n_The reporter attached a screenshot, but it could not be stored._');
  }

  if (browserInfo) {
    sections.push(`### Browser\n\n${details('Environment details', browserInfoTable(browserInfo))}`);
  }

  if (consoleLog) {
    sections.push(`### Console\n\n${details(`Last ${consoleLog.length} console entries`, consoleBlock(consoleLog))}`);
  }

  sections.push('---\n\n_Filed from the in-app reporter on Agent Resources._');

  return sections.join('\n\n');
};

module.exports = { buildIssueBody, buildIssueTitle, labelsFor, defuseMentions, BUG_LABEL, FEATURE_LABEL };
