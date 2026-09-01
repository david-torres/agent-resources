// GitHub REST adapter for the in-app reporter. The token lives here and
// nowhere else: nothing in this module is ever reachable from the browser.
const DEFAULT_REPO = 'david-torres/agent-resources';
const DEFAULT_API = 'https://api.github.com';

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const getIssueRepo = () => {
  const repo = (process.env.GITHUB_ISSUE_REPO || DEFAULT_REPO).trim();
  return REPO_PATTERN.test(repo) ? repo : null;
};

const getToken = () => (process.env.GITHUB_TOKEN || '').trim();

// The widget and the route both gate on this, so an unconfigured deploy shows
// no bug button at all rather than a button that fails on submit.
const isGithubConfigured = () => Boolean(getToken()) && Boolean(getIssueRepo());

const apiBase = () => (process.env.GITHUB_API_URL || DEFAULT_API).replace(/\/+$/, '');

/**
 * Create an issue. Resolves `{ data, error }` rather than throwing so callers
 * can map a GitHub outage onto a friendly 502 without a try/catch.
 *
 * @param {{title: string, body: string, labels?: string[]}} issue
 * @param {{fetchImpl?: typeof fetch}} [deps] `fetch` is injected by tests.
 */
const createIssue = async ({ title, body, labels = [] }, { fetchImpl = fetch } = {}) => {
  const repo = getIssueRepo();
  const token = getToken();
  if (!token || !repo) {
    return { data: null, error: { status: 503, message: 'Issue reporting is not configured.' } };
  }

  let response;
  try {
    response = await fetchImpl(`${apiBase()}/repos/${repo}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'agent-resources-feedback'
      },
      body: JSON.stringify({ title, body, labels })
    });
  } catch (cause) {
    console.error('GitHub issue create failed:', cause?.message || cause);
    return { data: null, error: { status: 502, message: 'Could not reach GitHub. Please try again.' } };
  }

  if (!response.ok) {
    // The response text is logged, never returned: it can echo the token's
    // scopes and the repository's private metadata.
    const detail = await response.text().catch(() => '');
    console.error(`GitHub issue create returned ${response.status}:`, detail.slice(0, 500));
    return { data: null, error: { status: 502, message: 'GitHub rejected the report. Please try again later.' } };
  }

  const payload = await response.json().catch(() => null);
  if (!payload?.html_url) {
    return { data: null, error: { status: 502, message: 'GitHub accepted the report but returned no issue.' } };
  }

  return { data: { url: payload.html_url, number: payload.number }, error: null };
};

module.exports = { createIssue, isGithubConfigured, getIssueRepo, DEFAULT_REPO };
