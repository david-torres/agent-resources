const { test, expect, describe } = require('bun:test');
const { FeedbackService, MAX_SCREENSHOT_BYTES } = require('./service');

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const pngFile = (buffer = PNG_MAGIC) => ({ mimetype: 'image/png', buffer });

const stubRepository = (overrides = {}) => {
  const calls = [];
  return {
    calls,
    uploadScreenshot: async (storagePath, bytes, contentType) => {
      calls.push({ storagePath, bytes, contentType });
      return { error: null };
    },
    getPublicUrl: (storagePath) => `https://cdn.test/bug-screenshots/${storagePath}`,
    ...overrides
  };
};

const stubGithub = (result = { data: { url: 'https://github.com/o/r/issues/1', number: 1 }, error: null }) => {
  const calls = [];
  return {
    calls,
    isGithubConfigured: () => true,
    createIssue: async (issue) => {
      calls.push(issue);
      return result;
    }
  };
};

const report = {
  kind: 'bug',
  title: 'Character sheet fails to save',
  description: 'I pressed save and nothing happened.'
};

const reporter = { name: 'Ada', profileId: 'profile-1' };

// The service logs the reason it dropped a screenshot; a deliberate failure
// test should not look like a broken suite.
const quietly = async (fn) => {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
};

describe('FeedbackService.submitReport', () => {
  test('files an issue and returns its URL', async () => {
    const github = stubGithub();
    const service = new FeedbackService(stubRepository(), github);

    const { data, error } = await service.submitReport({ input: report, reporter });

    expect(error).toBeNull();
    expect(data.url).toBe('https://github.com/o/r/issues/1');
    expect(github.calls).toHaveLength(1);
    expect(github.calls[0].title).toBe('[Bug] Character sheet fails to save');
    expect(github.calls[0].labels).toEqual(['bug']);
    expect(github.calls[0].body).toContain('Ada');
  });

  test('an unconfigured server refuses without touching GitHub', async () => {
    const github = { ...stubGithub(), isGithubConfigured: () => false };
    const service = new FeedbackService(stubRepository(), github);

    const { data, error } = await service.submitReport({ input: report, reporter });

    expect(data).toBeNull();
    expect(error.status).toBe(503);
    expect(github.calls).toHaveLength(0);
  });

  test('an invalid report never reaches GitHub', async () => {
    const github = stubGithub();
    const service = new FeedbackService(stubRepository(), github);

    const { error } = await service.submitReport({ input: { ...report, title: 'no' }, reporter });

    expect(error.status).toBe(400);
    expect(github.calls).toHaveLength(0);
  });

  test('uploads a screenshot under the reporter profile and links it in the body', async () => {
    const repository = stubRepository();
    const github = stubGithub();
    const service = new FeedbackService(repository, github);

    await service.submitReport({ input: report, screenshot: pngFile(), reporter });

    expect(repository.calls).toHaveLength(1);
    expect(repository.calls[0].storagePath).toStartWith('profile-1/');
    expect(repository.calls[0].storagePath).toEndWith('.png');
    expect(repository.calls[0].contentType).toBe('image/png');
    expect(github.calls[0].body).toContain('https://cdn.test/bug-screenshots/profile-1/');
  });

  // Losing the image must never lose the report -- the issue is still the
  // point, and the body says the screenshot went missing.
  test('a storage failure still files the issue and says the screenshot was lost', async () => {
    const repository = stubRepository({ uploadScreenshot: async () => ({ error: { message: 'bucket missing' } }) });
    const github = stubGithub();
    const service = new FeedbackService(repository, github);

    const { data, error } = await quietly(() => service.submitReport({ input: report, screenshot: pngFile(), reporter }));

    expect(error).toBeNull();
    expect(data.url).toBe('https://github.com/o/r/issues/1');
    expect(github.calls[0].body).toContain('could not be stored');
  });

  // The mimetype is client-supplied. Publishing arbitrary bytes to a PUBLIC
  // bucket on the strength of a declared type is exactly what this stops.
  test('bytes that do not match the declared image type are not uploaded', async () => {
    const repository = stubRepository();
    const github = stubGithub();
    const service = new FeedbackService(repository, github);

    await service.submitReport({
      input: report,
      screenshot: { mimetype: 'image/png', buffer: Buffer.from('<?php echo "not an image"; ?>') },
      reporter
    });

    expect(repository.calls).toHaveLength(0);
    expect(github.calls[0].body).toContain('could not be stored');
  });

  test('an unsupported image type is not uploaded', async () => {
    const repository = stubRepository();
    const service = new FeedbackService(repository, stubGithub());

    await service.submitReport({
      input: report,
      screenshot: { mimetype: 'image/svg+xml', buffer: Buffer.from('<svg onload="alert(1)"></svg>') },
      reporter
    });

    expect(repository.calls).toHaveLength(0);
  });

  test('an oversized screenshot is not uploaded', async () => {
    const repository = stubRepository();
    const service = new FeedbackService(repository, stubGithub());
    const oversized = Buffer.concat([PNG_MAGIC, Buffer.alloc(MAX_SCREENSHOT_BYTES)]);

    await service.submitReport({ input: report, screenshot: pngFile(oversized), reporter });

    expect(repository.calls).toHaveLength(0);
  });

  test('a feature request drops a posted screenshot instead of publishing it', async () => {
    const repository = stubRepository();
    const github = stubGithub();
    const service = new FeedbackService(repository, github);

    await service.submitReport({
      input: { ...report, kind: 'feature', title: 'Sort missions by date' },
      screenshot: pngFile(),
      reporter
    });

    expect(repository.calls).toHaveLength(0);
    expect(github.calls[0].labels).toEqual(['enhancement']);
    expect(github.calls[0].body).not.toContain('### Screenshot');
  });

  test('a GitHub failure is passed back to the caller', async () => {
    const github = stubGithub({ data: null, error: { status: 502, message: 'GitHub rejected the report.' } });
    const service = new FeedbackService(stubRepository(), github);

    const { data, error } = await service.submitReport({ input: report, reporter });

    expect(data).toBeNull();
    expect(error.status).toBe(502);
  });
});
