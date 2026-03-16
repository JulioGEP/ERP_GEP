require('ts-node/register/transpile-only');

const test = require('node:test');
const assert = require('node:assert/strict');

const { isScheduledInvocation, isWithinMadridAutomationWindow } = require('../_shared/slackSchedule.ts');

test('detects scheduled invocation from canonical schedule header', () => {
  const event = {
    headers: {
      'x-netlify-event': 'schedule',
    },
  };

  assert.equal(isScheduledInvocation(event), true);
});

test('detects scheduled invocation from netlify event type header', () => {
  const event = {
    headers: {
      'x-netlify-event-type': 'scheduled',
    },
  };

  assert.equal(isScheduledInvocation(event), true);
});

test('detects scheduled invocation from scheduled-at headers', () => {
  const withNetlifyHeader = {
    headers: {
      'x-netlify-scheduled-at': '2026-03-16T06:00:00.000Z',
    },
  };

  const withNfHeader = {
    headers: {
      'x-nf-scheduled-at': '2026-03-16T06:00:00.000Z',
    },
  };

  assert.equal(isScheduledInvocation(withNetlifyHeader), true);
  assert.equal(isScheduledInvocation(withNfHeader), true);
});

test('does not mark manual invocation as scheduled', () => {
  const event = {
    headers: {
      host: 'erpgep.netlify.app',
    },
  };

  assert.equal(isScheduledInvocation(event), false);
});

test('accepts whole 07:00 Madrid hour automation window', () => {
  assert.equal(isWithinMadridAutomationWindow('2026-03-16T07:00:00.000+01:00'), true);
  assert.equal(isWithinMadridAutomationWindow('2026-03-16T07:59:59.999+01:00'), true);
  assert.equal(isWithinMadridAutomationWindow('2026-03-16T06:59:59.999+01:00'), false);
  assert.equal(isWithinMadridAutomationWindow('2026-03-16T08:00:00.000+01:00'), false);
});
