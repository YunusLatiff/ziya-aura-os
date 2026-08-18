import assert from 'node:assert/strict';

import {
  natashaConfig,
  buildOrganicPost
} from '../src/natasha.mjs';

const cfg=natashaConfig();

assert.equal(
  cfg.mode,
  'ORGANIC_ONLY'
);

assert.equal(
  cfg.monthlyAdBudgetR,
  0
);

assert.equal(
  cfg.paidAdvertisingEnabled,
  false
);

assert.deepEqual(
  cfg.platforms,
  [
    'FACEBOOK',
    'INSTAGRAM'
  ]
);

assert.deepEqual(
  cfg.paidMedia.futureBudgetTiers,
  [
    6000,
    10000,
    15000,
    20000,
    25000,
    30000
  ]
);

const post=buildOrganicPost({
  index:0,
  scheduledAt:
    '2026-08-19T09:00:00+02:00'
});

assert.equal(
  post.agent,
  'Natasha'
);

assert.equal(
  post.mode,
  'ORGANIC_ONLY'
);

assert.equal(
  post.paid,
  false
);

assert.equal(
  post.paidBudgetR,
  0
);

assert.ok(
  post.platforms.includes(
    'FACEBOOK'
  )
);

assert.ok(
  post.platforms.includes(
    'INSTAGRAM'
  )
);

assert.ok(
  post.caption.length>100
);

assert.ok(
  post.creativeBrief
);

console.log(
  'Natasha v1 organic foundation tests passed.'
);
