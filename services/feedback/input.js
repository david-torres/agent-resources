// Pure normalization for a submitted bug report / feature request.
//
// Everything here arrives from the browser, so nothing is trusted: the caps
// below are what keeps a report from turning into a multi-megabyte issue body,
// and stripControl removes the ANSI escapes and stray NULs that a console log
// picks up from library output.
const KINDS = new Set(['bug', 'feature']);

const MAX_TITLE = 120;
const MAX_DESCRIPTION = 5000;
const MAX_URL = 500;
const MAX_CONSOLE_ENTRIES = 50;
const MAX_CONSOLE_MESSAGE = 500;
const MAX_BROWSER_INFO_VALUE = 200;

// The browser-info keys we render. An unknown key is dropped rather than
// passed through, so a tampered payload cannot inject arbitrary rows.
const BROWSER_INFO_KEYS = [
  'userAgent',
  'platform',
  'language',
  'viewport',
  'screen',
  'devicePixelRatio',
  'timezone',
  'online',
  'cookiesEnabled'
];

const CONSOLE_LEVELS = new Set(['log', 'info', 'warn', 'error', 'debug']);

// Keep tabs and newlines; drop the rest of C0/C1 plus the NUL that Postgres
// rejects outright.
const stripControl = (value) => String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');

const clamp = (value, max) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

const text = (value, max) => clamp(stripControl(value == null ? '' : value).trim(), max);

// A single-line field: a title with newlines in it would break the issue
// title outright, so they collapse to spaces before the length cap.
const singleLine = (value, max) => text(String(value == null ? '' : value).replace(/\s+/g, ' '), max);

const parseMaybeJson = (value) => {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
};

const normalizeBrowserInfo = (raw) => {
  const parsed = parseMaybeJson(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const info = {};
  for (const key of BROWSER_INFO_KEYS) {
    const value = parsed[key];
    if (value === undefined || value === null || value === '') continue;
    info[key] = singleLine(typeof value === 'boolean' || typeof value === 'number' ? String(value) : value, MAX_BROWSER_INFO_VALUE);
  }
  return Object.keys(info).length > 0 ? info : null;
};

const normalizeConsoleLog = (raw) => {
  const parsed = parseMaybeJson(raw);
  if (!Array.isArray(parsed)) return null;

  // Keep the tail: the entries nearest the report are the ones describing
  // what just went wrong.
  const entries = parsed
    .slice(-MAX_CONSOLE_ENTRIES)
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const message = text(entry.message, MAX_CONSOLE_MESSAGE);
      if (!message) return null;
      return {
        level: CONSOLE_LEVELS.has(entry.level) ? entry.level : 'log',
        at: singleLine(entry.at, 40),
        message
      };
    })
    .filter(Boolean);

  return entries.length > 0 ? entries : null;
};

// Only an http(s) URL is worth recording, and only as text — it is rendered
// as a fenced value, never as a link target.
const normalizePageUrl = (raw) => {
  const value = singleLine(raw, MAX_URL);
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return value;
  } catch {
    return null;
  }
};

const normalizeFeedbackInput = (raw = {}) => {
  const kind = KINDS.has(raw.kind) ? raw.kind : null;
  if (!kind) {
    return { data: null, error: { status: 400, message: 'Choose whether this is a bug or a feature request.' } };
  }

  const title = singleLine(raw.title, MAX_TITLE);
  if (title.length < 5) {
    return { data: null, error: { status: 400, message: 'Give the report a title of at least 5 characters.' } };
  }

  const description = text(raw.description, MAX_DESCRIPTION);
  if (description.length < 10) {
    return { data: null, error: { status: 400, message: 'Describe the problem or request in at least 10 characters.' } };
  }

  // Diagnostics are bug-report material. A feature request that somehow
  // carries them drops them here rather than in the body builder, so the
  // service and the issue body agree on what a feature request contains.
  const isBug = kind === 'bug';

  return {
    data: {
      kind,
      title,
      description,
      pageUrl: normalizePageUrl(raw.pageUrl ?? raw.page_url),
      browserInfo: isBug ? normalizeBrowserInfo(raw.browserInfo ?? raw.browser_info) : null,
      consoleLog: isBug ? normalizeConsoleLog(raw.consoleLog ?? raw.console_log) : null
    },
    error: null
  };
};

module.exports = {
  normalizeFeedbackInput,
  BROWSER_INFO_KEYS,
  MAX_TITLE,
  MAX_DESCRIPTION,
  MAX_CONSOLE_ENTRIES,
  MAX_CONSOLE_MESSAGE
};
