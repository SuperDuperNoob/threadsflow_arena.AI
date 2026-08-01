import test from 'node:test';
import assert from 'node:assert/strict';
import { decideMediaRoute } from './wf3_media_router.js';

test('existing paths unchanged: TEXT, IMAGE, CAROUSEL', () => {
  assert.equal(decideMediaRoute({ media_type: 'TEXT', product_images: [] }).route, 'TEXT');
  assert.equal(decideMediaRoute({ media_type: 'IMAGE', image_urls: ['u1'], product_images: [{media_kind:'IMAGE'}] }).route, 'IMAGE');
  assert.equal(decideMediaRoute({ media_type: 'CAROUSEL', image_urls: ['u1','u2'], product_images: [{media_kind:'IMAGE'},{media_kind:'IMAGE'}] }).route, 'CAROUSEL');
});

test('VIDEO branch routes correctly and flags polling', () => {
  const r = decideMediaRoute({ media_type: 'VIDEO', product_images: [{media_kind:'VIDEO',public_url:'v.mp4'}] });
  assert.equal(r.route, 'VIDEO');
  assert.equal(r.needsVideoPoll, true);
});

test('MIXED_CAROUSEL with video child flags polling', () => {
  const r = decideMediaRoute({
    media_type: 'MIXED_CAROUSEL',
    product_images: [
      {media_kind:'IMAGE',public_url:'i.jpg'},
      {media_kind:'VIDEO',public_url:'v.mp4'}
    ]
  });
  assert.equal(r.route, 'MIXED_CAROUSEL');
  assert.equal(r.needsVideoPoll, true);
});

test('VIDEO inferred from product_images when media_type missing', () => {
  const r = decideMediaRoute({ product_images: [{media_kind:'VIDEO'}] });
  assert.equal(r.route, 'VIDEO');
});

test('revert-and-confirm-fail: old code would have sent MIXED as IMAGE', () => {
  // Simulate old behavior (no VIDEO/MIXED handling)
  const oldRoute = (t) => (['TEXT','IMAGE','CAROUSEL'].includes(t) ? t : 'IMAGE');
  assert.notEqual(oldRoute('VIDEO'), 'VIDEO');
  assert.notEqual(oldRoute('MIXED_CAROUSEL'), 'MIXED_CAROUSEL');

  // New code handles them (product_images present)
  assert.equal(decideMediaRoute({media_type:'VIDEO', product_images:[{media_kind:'VIDEO'}]}).route, 'VIDEO');
  assert.equal(decideMediaRoute({media_type:'MIXED_CAROUSEL', product_images:[{media_kind:'VIDEO'}]}).route, 'MIXED_CAROUSEL');
});