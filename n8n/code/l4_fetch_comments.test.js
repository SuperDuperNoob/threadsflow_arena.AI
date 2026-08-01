import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { prepareFetchUrls } from './l4_fetch_comments.js';

describe('l4_fetch_comments - prepareFetchUrls', () => {
  test('builds fetch URL from threads_media_id', () => {
    const input = {
      access_token: 'test_token',
      posts: [
        { id: 1, uid: 'post1', threads_media_id: '1234567890', published_at: new Date().toISOString() },
      ],
    };
    const result = prepareFetchUrls(input);
    assert.equal(result.length, 1);
    assert.equal(result[0].json.fetch_url, 'https://graph.threads.net/v1.0/1234567890/replies');
    assert.equal(result[0].json.threads_media_id, '1234567890');
    assert.equal(result[0].json.post_uid, 'post1');
    assert.equal(result[0].json.post_id, 1);
  });

  test('filters out posts without threads_media_id', () => {
    const input = {
      access_token: 'test_token',
      posts: [
        { id: 1, uid: 'post1', threads_media_id: '1234567890', published_at: new Date().toISOString() },
        { id: 2, uid: 'post2', threads_media_id: null, published_at: new Date().toISOString() },
        { id: 3, uid: 'post3', published_at: new Date().toISOString() }, // missing threads_media_id
      ],
    };
    const result = prepareFetchUrls(input);
    assert.equal(result.length, 1);
    assert.equal(result[0].json.post_uid, 'post1');
  });

  test('returns error when access_token is missing', () => {
    const input = {
      posts: [{ id: 1, uid: 'post1', threads_media_id: '1234567890' }],
    };
    const result = prepareFetchUrls(input);
    assert.equal(result.length, 1);
    assert.equal(result[0].json._error, 'access_token is required');
  });

  test('returns empty when no posts provided', () => {
    const input = { access_token: 'test_token', posts: [] };
    const result = prepareFetchUrls(input);
    assert.equal(result.length, 1);
    assert.equal(result[0].json._empty, true);
  });
});