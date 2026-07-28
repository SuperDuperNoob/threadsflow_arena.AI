import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  buildAuthorization,
  parseItemIdFromUrl,
  productOfferQuery,
  conversionReportQuery,
  callShopee,
  configureShopee,
  ShopeeApiError,
  ShopeeNotConfigured,
} from './shopee.js';
import { mapConversionNodes, upsertConversionRows } from './shopee_conversions.js';

const APP_ID = '123456';
const SECRET = 'secret_key';

test('buildAuthorization produces the exact SHA256 header Shopee expects', () => {
  const payload = JSON.stringify({ query: '{ shopeeOfferV2 { pageInfo { page } } }' });
  const timestamp = 1712000000;
  const expectedSig = crypto
    .createHash('sha256')
    .update(`${APP_ID}${timestamp}${payload}${SECRET}`)
    .digest('hex');
  const header = buildAuthorization(APP_ID, SECRET, payload, timestamp);
  assert.equal(
    header,
    `SHA256 Credential=${APP_ID}, Timestamp=${timestamp}, Signature=${expectedSig}`,
  );
});

test('parseItemIdFromUrl handles the common Shopee URL shapes', () => {
  assert.equal(parseItemIdFromUrl('https://shopee.com.my/product/38003654/1589295236'), 1589295236);
  assert.equal(parseItemIdFromUrl('https://shopee.com.my/i.38003654.1589295236'), 1589295236);
  assert.equal(parseItemIdFromUrl('https://shopee.com.my/My-Shop.38003654.1589295236'), 1589295236);
  assert.equal(parseItemIdFromUrl('https://s.shopee.com.my/ABC?item_id=1589295236'), 1589295236);
  assert.equal(parseItemIdFromUrl('https://not-shopee.example/foo'), null);
});

test('productOfferQuery injects itemId/keyword and is valid GraphQL-ish', () => {
  const q = productOfferQuery({ itemId: 1589295236, limit: 5 });
  assert.match(q, /productOfferV2\(/);
  assert.match(q, /itemId: 1589295236/);
  assert.match(q, /limit: 5/);
  assert.match(q, /commissionRate/);
  // keyword is embedded as a JSON-style string literal (safe escaping)
  const q2 = productOfferQuery({ keyword: 'a"b', limit: 1 });
  assert.match(q2, /keyword: "a\\"b"/);
});

test('conversionReportQuery includes utmContent and order items', () => {
  const q = conversionReportQuery({ purchaseTimeStart: 1, purchaseTimeEnd: 2, limit: 50 });
  assert.match(q, /conversionReport\(/);
  assert.match(q, /purchaseTimeStart: 1/);
  assert.match(q, /utmContent/);
  assert.match(q, /items \{/);
  assert.match(q, /scrollId/);
});

test('callShopee signs the exact body it sends and returns data', async () => {
  let captured;
  const realFetch = global.fetch;
  global.fetch = async (u, opts) => {
    captured = { u, body: opts.body, auth: opts.headers.Authorization };
    return {
      ok: true,
      json: async () => ({ data: { productOfferV2: { nodes: [{ itemId: 1 }] } } }),
    };
  };
  try {
    const payload = JSON.stringify({ query: '{ x }' });
    const ts = Math.floor(Date.now() / 1000);
    const sig = crypto.createHash('sha256').update(`${APP_ID}${ts}${payload}${SECRET}`).digest('hex');
    const expectedAuth = `SHA256 Credential=${APP_ID}, Timestamp=${ts}, Signature=${sig}`;

    const data = await callShopee('{ x }', { appId: APP_ID, secret: SECRET });
    assert.deepEqual(data, { productOfferV2: { nodes: [{ itemId: 1 }] } });
    assert.equal(captured.body, payload);
    assert.equal(captured.auth, expectedAuth);
  } finally {
    global.fetch = realFetch;
  }
});

test('callShopee throws ShopeeApiError on GraphQL errors', async () => {
  const realFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ errors: [{ message: 'Invalid Signature', extensions: { code: 10020 } }] }),
  });
  try {
    await assert.rejects(
      () => callShopee('{ x }', { appId: APP_ID, secret: SECRET }),
      (e) => e instanceof ShopeeApiError && e.code === 10020,
    );
  } finally {
    global.fetch = realFetch;
  }
});

test('callShopee rejects non-2xx HTTP responses without GraphQL errors', async () => {
  const realFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ message: 'maintenance' }),
  });
  try {
    await assert.rejects(
      () => callShopee('{ x }', { appId: APP_ID, secret: SECRET }),
      (e) => e instanceof ShopeeApiError && e.code === 503 && e.message === 'maintenance',
    );
  } finally {
    global.fetch = realFetch;
  }
});

test('callShopee throws ShopeeNotConfigured when no credentials', async () => {
  configureShopee({ appId: '', secret: '' });
  await assert.rejects(() => callShopee('{ x }'), ShopeeNotConfigured);
});

test('mapConversionNodes maps utmContent (sub_id) -> post_uid and one row per order', () => {
  const nodes = [
    {
      conversionId: 111,
      purchaseTime: 1700000000,
      totalCommission: '100',
      utmContent: 'p8fk2q',
      orders: [
        {
          orderId: 'O1',
          orderStatus: 'COMPLETED',
          items: [{ itemName: 'Phone', actualAmount: '50', itemTotalCommission: '100' }],
        },
        { orderId: 'O2', orderStatus: 'CANCELLED', items: [] },
      ],
    },
    { conversionId: 222, purchaseTime: 1700000500, totalCommission: '70', utmContent: null, orders: [] },
  ];
  const rows = mapConversionNodes(nodes);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].post_uid, 'p8fk2q');
  assert.equal(rows[0].order_id, 'O1');
  assert.equal(rows[0].status, 'completed');
  assert.equal(rows[0].commission, 100);
  assert.equal(rows[0].gmv, 50);
  assert.equal(rows[1].order_id, 'O2');
  assert.equal(rows[1].status, 'cancelled');
  // conversion with no orders -> single pending row keyed by conversionId, post_uid null
  assert.equal(rows[2].order_id, '222');
  assert.equal(rows[2].post_uid, null);
  assert.equal(rows[2].status, 'pending');
  assert.equal(rows[2].commission, 70);
});

test('mapConversionNodes sums item commission per order instead of duplicating conversion total', () => {
  const rows = mapConversionNodes([{
    conversionId: 333,
    totalCommission: '100',
    orders: [
      { orderId: 'A', items: [{ itemTotalCommission: '30', actualAmount: '10' }] },
      { orderId: 'B', items: [{ itemTotalCommission: '70', actualAmount: '20' }] },
    ],
  }]);
  assert.deepEqual(rows.map((r) => r.commission), [30, 70]);
});

test('upsertConversionRows writes currency-neutral columns (historical *_idr are generated)', async () => {
  const statements = [];
  const pool = {
    async query(sql) {
      statements.push(sql);
      if (/RETURNING/.test(sql)) return { rows: [{ inserted: true }] };
      return { rows: [] };
    },
  };
  const result = await upsertConversionRows(pool, [{ order_id: 'O1', gmv: 50, commission: 5 }]);
  const insert = statements.find((sql) => /INSERT INTO conversions/.test(sql));
  assert.match(insert, /gmv_minor/);
  assert.match(insert, /commission_minor/);
  assert.doesNotMatch(insert, /gmv_idr|commission_idr/);
  assert.deepEqual(result, { inserted: 1, updated: 0 });
});
