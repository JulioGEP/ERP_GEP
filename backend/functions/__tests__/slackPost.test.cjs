require('ts-node/register/transpile-only');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getSlackRetryOptions,
  postSlackMessageWithRetry,
} = require('../_shared/slackPost.ts');

test('getSlackRetryOptions normalizes values and applies limits', () => {
  assert.deepEqual(getSlackRetryOptions(null), { attempts: 3, delayMs: 1500 });
  assert.deepEqual(getSlackRetryOptions({ attempts: '7', delayMs: '5000' }), { attempts: 7, delayMs: 5000 });
  assert.deepEqual(getSlackRetryOptions({ attempts: '99', delayMs: '99999' }), { attempts: 10, delayMs: 15000 });
});

test('postSlackMessageWithRetry retries temporary Slack failures until success', async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (_url, init) => {
    calls.push(init);
    if (calls.length < 3) {
      return {
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ ok: false, error: 'ratelimited' }),
      };
    }

    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    };
  };

  try {
    const result = await postSlackMessageWithRetry('token-demo', 'hola', {
      channel: 'C123',
      attempts: 5,
      delayMs: 1,
      logger: {
        info() {},
        warn() {},
      },
    });

    assert.deepEqual(result, { attemptsRequested: 5, attemptsUsed: 3 });
    assert.equal(calls.length, 3);
  } finally {
    global.fetch = originalFetch;
  }
});

test('postSlackMessageWithRetry does not retry permanent Slack errors', async () => {
  const originalFetch = global.fetch;
  let calls = 0;

  global.fetch = async () => {
    calls += 1;
    return {
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ ok: false, error: 'invalid_auth' }),
    };
  };

  try {
    await assert.rejects(
      () =>
        postSlackMessageWithRetry('token-demo', 'hola', {
          channel: 'C123',
          attempts: 5,
          delayMs: 1,
          logger: {
            info() {},
            warn() {},
          },
        }),
      /invalid_auth/,
    );

    assert.equal(calls, 1);
  } finally {
    global.fetch = originalFetch;
  }
});
