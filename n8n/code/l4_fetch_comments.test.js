// Guards the wf7 handoff contract: posts carry `threads_media_id` (the real posts column),
// not the phantom `media_uid`. Run: node --test n8n/code/l4_fetch_comments.test.js
const assert = require('node:assert');
const { test } = require('node:test');
const { prepareFetchUrls } = require('./l4_fetch_comments.js');

test('prepareFetchUrls builds the replies URL from threads_media_id', () => {
  const out = prepareFetchUrls({
    access_token: 'tok',
    posts: [{ id: 1, uid: 'abc', threads_media_id: '17890', published_at: '2026-01-01' }],
  });
  assert.equal(out.length, 1);
  assert.match(out[0].json.fetch_url, /\/17890\/replies$/);
  assert.equal(out[0].json.threads_media_id, '17890');
});

test('posts without threads_media_id are filtered out (not fetched with undefined)', () => {
  const out = prepareFetchUrls({
    access_token: 'tok',
    posts: [{ id: 2, uid: 'def', media_uid: 'legacy', published_at: '2026-01-01' }],
  });
  assert.equal(out.length, 0);
});
