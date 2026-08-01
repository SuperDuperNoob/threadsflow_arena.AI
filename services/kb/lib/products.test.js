import test from 'node:test';
import assert from 'node:assert/strict';

import { describeImage } from './products.js';

test('describeImage skips the vision call entirely for VIDEO media', async () => {
  const realFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => { fetchCalls++; throw new Error('fetch must not be called for VIDEO'); };
  try {
    const d = await describeImage('https://cdn.example/clip.mp4', 'VIDEO');
    assert.equal(d, null);
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = realFetch;
  }
});

test('describeImage still runs vision description for IMAGE media (default behavior preserved)', async () => {
  const realFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls++;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ desc: 'kasut sukan biru di atas meja kayu' }) } }],
      }),
    };
  };
  try {
    const d = await describeImage('https://cdn.example/shoe.jpg', 'IMAGE');
    assert.equal(fetchCalls, 1);
    assert.equal(d, 'kasut sukan biru di atas meja kayu');
  } finally {
    global.fetch = realFetch;
  }
});

test('describeImage defaults mediaKind to IMAGE when not passed (back-compat with old call sites)', async () => {
  const realFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls++;
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ desc: 'default case' }) } }] }),
    };
  };
  try {
    const d = await describeImage('https://cdn.example/shoe.jpg');
    assert.equal(fetchCalls, 1);
    assert.equal(d, 'default case');
  } finally {
    global.fetch = realFetch;
  }
});
