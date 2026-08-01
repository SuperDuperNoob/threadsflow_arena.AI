import test from 'node:test';
import assert from 'node:assert/strict';
import { configureApify, registerApifyPool, getApifyAvailability, parseShopeeProductIds, enrichProductFromApify, runApifyActor } from './apify_shopee.js';

test('parses normal product URLs but intentionally rejects affiliate short links', () => {
  assert.deepEqual(parseShopeeProductIds('https://shopee.com.my/product/1/2'), { shopId: 1, itemId: 2 });
  assert.equal(parseShopeeProductIds('https://s.shopee.com.my/abc'), null);
});

test('missing credentials do not call the network', async () => {
  configureApify({ token: '' }); registerApifyPool({ query: async () => ({ rows: [] }) });
  assert.equal((await getApifyAvailability()).configured, false);
  const real=global.fetch; global.fetch=async()=>{throw Error('network called')};
  try { assert.deepEqual(await enrichProductFromApify('https://shopee.com.my/product/1/2'), { ok:false, reason:'not_configured' }); } finally { global.fetch=real; }
});

test('uses bearer auth without putting a legacy token in the URL', async () => {
  configureApify({ token: 'secret-token' }); registerApifyPool({ query: async () => ({ rows: [] }) });
  const real=global.fetch; let req;
  global.fetch=async(url,opts)=>{req={url,opts};return {ok:true,json:async()=>[{data:{item:{item_id:2,shop_id:1,title:'Test',price:1990000,image:'image'}}}]}};
  try { const r=await enrichProductFromApify('https://shopee.com.my/product/1/2'); assert.equal(r.ok,true); assert.equal(r.price_min,19.9); assert.equal(req.opts.headers.Authorization,'Bearer secret-token'); assert.doesNotMatch(req.url,/secret-token/); } finally {global.fetch=real;}
});

test('rotates to the next stored key after a quota response', async () => {
  configureApify({ token: '' }); let calls=0;
  registerApifyPool({ query: async sql => { if (/SELECT id,label,token/.test(sql)) return {rows:[{id:1,label:'first',token:'one'},{id:2,label:'second',token:'two'}]}; if (/RETURNING runs/.test(sql)) return {rows:[{runs:1}]}; return {rows:[]}; } });
  const real=global.fetch; global.fetch=async(_u,o)=>{calls++; return calls===1?{ok:false,status:429,json:async()=>({})}:{ok:true,json:async()=>[]};};
  try { const r=await runApifyActor('xtracto~shopee-search',{}); assert.equal(r.ok,true); assert.equal(r.keyLabel,'second'); assert.equal(calls,2); } finally {global.fetch=real;}
});
