const { test, expect, describe, beforeEach, afterEach } = require('bun:test');
const { createIssue, isGithubConfigured, getIssueRepo, DEFAULT_REPO } = require('./github');

const ENV_KEYS = ['GITHUB_TOKEN', 'GITHUB_ISSUE_REPO', 'GITHUB_API_URL'];
const saved = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

// Swallows the console.error the adapter writes on every failure path, so a
// deliberate failure test doesn't look like a broken suite.
const quietly = async (fn) => {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
};

describe('configuration', () => {
  test('is not configured without a token', () => {
    expect(isGithubConfigured()).toBe(false);
  });

  test('is configured with a token, defaulting to this repository', () => {
    process.env.GITHUB_TOKEN = 'ghp_test';
    expect(isGithubConfigured()).toBe(true);
    expect(getIssueRepo()).toBe(DEFAULT_REPO);
  });

  // A malformed value would otherwise be pasted straight into the request
  // path, so it disables the feature instead.
  test('a malformed repo disables the feature rather than building a bad URL', () => {
    process.env.GITHUB_TOKEN = 'ghp_test';
    process.env.GITHUB_ISSUE_REPO = 'not a repo/../../etc';
    expect(getIssueRepo()).toBeNull();
    expect(isGithubConfigured()).toBe(false);
  });
});

describe('createIssue', () => {
  test('refuses to call GitHub when no token is set', async () => {
    let called = false;
    const { data, error } = await createIssue(
      { title: 't', body: 'b' },
      { fetchImpl: async () => { called = true; } }
    );
    expect(called).toBe(false);
    expect(data).toBeNull();
    expect(error.status).toBe(503);
  });

  test('posts the issue with auth headers and returns its URL', async () => {
    process.env.GITHUB_TOKEN = 'ghp_test';
    process.env.GITHUB_ISSUE_REPO = 'octo/repo';
    process.env.GITHUB_API_URL = 'https://api.test.invalid';

    let request = null;
    const { data, error } = await createIssue(
      { title: 'A title', body: 'A body', labels: ['bug'] },
      {
        fetchImpl: async (url, options) => {
          request = { url, options };
          return { ok: true, status: 201, json: async () => ({ html_url: 'https://github.com/octo/repo/issues/7', number: 7 }) };
        }
      }
    );

    expect(error).toBeNull();
    expect(data).toEqual({ url: 'https://github.com/octo/repo/issues/7', number: 7 });
    expect(request.url).toBe('https://api.test.invalid/repos/octo/repo/issues');
    expect(request.options.method).toBe('POST');
    expect(request.options.headers.Authorization).toBe('Bearer ghp_test');
    expect(JSON.parse(request.options.body)).toEqual({ title: 'A title', body: 'A body', labels: ['bug'] });
  });

  // The response body can echo token scopes and private repository metadata,
  // so the caller gets a fixed message and the detail goes to the log only.
  test('a GitHub error becomes a 502 that does not leak the response body', async () => {
    process.env.GITHUB_TOKEN = 'ghp_test';
    const { data, error } = await quietly(() => createIssue(
      { title: 't', body: 'b' },
      { fetchImpl: async () => ({ ok: false, status: 403, text: async () => 'Resource not accessible by personal access token' }) }
    ));

    expect(data).toBeNull();
    expect(error.status).toBe(502);
    expect(error.message).not.toContain('personal access token');
  });

  test('a network failure becomes a 502 rather than a thrown error', async () => {
    process.env.GITHUB_TOKEN = 'ghp_test';
    const { data, error } = await quietly(() => createIssue(
      { title: 't', body: 'b' },
      { fetchImpl: async () => { throw new Error('ECONNREFUSED'); } }
    ));

    expect(data).toBeNull();
    expect(error.status).toBe(502);
  });

  test('a 2xx with no issue URL is still a failure', async () => {
    process.env.GITHUB_TOKEN = 'ghp_test';
    const { data, error } = await createIssue(
      { title: 't', body: 'b' },
      { fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) }
    );

    expect(data).toBeNull();
    expect(error.status).toBe(502);
  });
});
