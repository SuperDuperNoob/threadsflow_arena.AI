import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitize, hostOnly, snippet, debugActive } from './logger.js';

test('masks secret-looking keys', () => {
  const out = sanitize({ api_key: 'sk-abc123', token: 'x', password: 'p', model: 'gpt-4.1-mini' });
  assert.equal(out.api_key, '***');
  assert.equal(out.token, '***');
  assert.equal(out.password, '***');
  assert.equal(out.model, 'gpt-4.1-mini');
});

test('masks bearer tokens and sk- keys inside strings', () => {
  const out = sanitize({ note: 'auth was Bearer abcDEF123456789 with sk-live1234567890abc' });
  assert.ok(!out.note.includes('abcDEF123456789'), out.note);
  assert.ok(!out.note.includes('sk-live1234567890abc'), out.note);
});

test('masks Threads/Meta-style tokens', () => {
  const out = sanitize({ m: 'token THAAxxxxxxxxxxxxxxxxxxxxxxx leaked' });
  assert.ok(!out.m.includes('THAAxxxxxxxxxxxxxxxxxxxxxxx'), out.m);
});

test('strips query strings from URLs (affiliate links)', () => {
  const out = sanitize({ url: 'https://s.shopee.com.my/ABC123?sub_id=zz9&af_id=secret' });
  assert.equal(out.url, 'https://s.shopee.com.my/ABC123');
});

test('masks access_token params embedded in longer text', () => {
  const out = sanitize({ m: 'GET failed for path?access_token=EAAG123456 more text' });
  assert.ok(!out.m.includes('EAAG123456'), out.m);
});

test('hostOnly never returns path or query', () => {
  assert.equal(hostOnly('https://shopee.com.my/product/1/2?af=key'), 'shopee.com.my');
  assert.equal(hostOnly('not a url'), null);
});

test('snippet truncates to 120 chars by default', () => {
  assert.equal(snippet('a'.repeat(200)).length, 121); // 120 + ellipsis
  assert.equal(snippet('short'), 'short');
});

test('debugActive respects DEBUG_MODE and DEBUG_UNTIL', () => {
  assert.equal(debugActive({ DEBUG_MODE: 'false' }), false);
  assert.equal(debugActive({ DEBUG_MODE: 'true' }), true);
  assert.equal(debugActive({ DEBUG_MODE: 'true', DEBUG_UNTIL: '2000-01-01T00:00:00Z' }), false);
  assert.equal(debugActive({ DEBUG_MODE: 'true', DEBUG_UNTIL: '2999-01-01T00:00:00Z' }), true);
});
