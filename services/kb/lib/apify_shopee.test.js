import test from 'node:test';
import assert from 'node:assert/strict';
import {
  configureApify,
  registerApifyPool,
  getApifyAvailability,
  parseShopeeProductIds,
  enrichProductFromApify,
} from './apify_shopee.js';

const fakePool = (onQuery = async () => ({ rows: [{ runs: 1 }] })) => ({ query: onQuery });

test('parses full Shopee MY product URLs but not affiliate short links', () => {
  assert.deepEqual(parseShopeeProductIds('https://shopee.com.my/product/43768/18938427295'), { shopId: 43768, itemId: 18938427295 });
  assert.deepEqual(parseShopeeProductIds('https://shopee.com.my/Thing-i.43768.18938427295'), { shopId: 43768, itemId: 18938427295 });
  assert.equal(parseShopeeProductIds('https://s.shopee.com.my/abc'), null);
  assert.equal(parseShopeeProductIds('https://example.com/i.1.2'), null);
});

test('does not call Apify without a token and hard-caps the default free-tier budget', async () => {
  configureApify({ token: '', monthlyMaxRuns: 9999 });
  registerApifyPool(fakePool());
  assert.deepEqual(await getApifyAvailability(), {
    configured: false, missing: ['token'], actor: 'chartedsea/shopee-api-scraper', monthly_max_runs: 25,
  });
  const realFetch = global.fetch;
  global.fetch = async () => { throw new Error('must not call fetch'); };
  try {
    assert.deepEqual(
      await enrichProductFromApify('https://shopee.com.my/product/1/2'),
      { ok: false, reason: 'not_configured' },
    );
  } finally { global.fetch = realFetch; }
});

test('reserves one budgeted run, keeps token out of URL, and normalizes a product result', async () => {
  configureApify({ token: 'secret-token', monthlyMaxRuns: 25 });
  let reserved = 0;
  registerApifyPool(fakePool(async (sql) => {
    if (/apify_monthly_usage/.test(sql)) { reserved++; return { rows: [{ runs: 1 }] }; }
    return { rows: [] };
  }));
  const realFetch = global.fetch;
  let request;
  global.fetch = async (url, opts) => {
    request = { url, opts };
    return {
      ok: true,
      json: async () => [{ data: { item: {
        item_id: 2, shop_id: 1, title: 'Useful product', description: 'A concrete description',
        price: 1990000, image: 'my-image', images: ['my-image'], historical_sold: 12,
      }, product_review: { rating_star: 4.8, rating_count: 9, ratings: [
        { comment: 'Barang kemas dan sampai cepat', author_username: 'must-not-store' },
      ] }, shop_detailed: { name: 'Good Shop', username: 'good_shop' } } }],
    };
  };
  try {
    const out = await enrichProductFromApify('https://shopee.com.my/product/1/2');
    assert.equal(reserved, 1);
    assert.match(request.url, /chartedsea~shopee-api-scraper/);
    assert.doesNotMatch(request.url, /secret-token/);
    assert.equal(request.opts.headers.Authorization, 'Bearer secret-token');
    assert.equal(out.ok, true);
    assert.equal(out.price_min, 19.9);
    assert.deepEqual(out.top_reviews, ['Barang kemas dan sampai cepat']);
    assert.equal(JSON.stringify(out).includes('must-not-store'), false);
  } finally { global.fetch = realFetch; }
});

test('does not make a request when the atomic monthly budget is exhausted', async () => {
  configureApify({ token: 'secret-token' });
  registerApifyPool(fakePool(async () => ({ rows: [] })));
  const realFetch = global.fetch;
  global.fetch = async () => { throw new Error('budget exhausted must not fetch'); };
  try {
    assert.deepEqual(
      await enrichProductFromApify('https://shopee.com.my/product/1/2'),
      { ok: false, reason: 'monthly_limit_reached' },
    );
  } finally { global.fetch = realFetch; }
});
