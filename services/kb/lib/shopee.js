/**
 * Shopee Affiliate Open API client.
 *
 * GraphQL endpoint (Malaysia): https://open-api.affiliate.shopee.com.my/graphql
 * Auth: SHA256 Credential=<appId>, Timestamp=<ts>, Signature=<sha256(appId+ts+payload+secret)>
 *
 * Reference implementation: https://github.com/bcat95/shopee-aff
 * Official docs (per country): <affiliate domain>/open_api/list
 *
 * This module is SELF-CONTAINED and never throws into the caller's flow on its own — every
 * exported "wrapper" returns null / an empty array / {ok:false} on failure so the product
 * intake and learning loops can degrade gracefully (the whole repo's core principle).
 *
 * Credentials are resolved in this order:
 *   1. configureShopee({ appId, secret, url })         — explicit, for tests/CLI
 *   2. env SHOPEE_API_APP_ID / SHOPEE_API_SECRET / SHOPEE_OPENAPI_URL
 *   3. settings table rows shopee_app_id / shopee_app_secret   (if a pool was registered)
 */

import crypto from 'node:crypto';

// ── Malaysia is the default because this repo targets shopee.com.my. Set
// SHOPEE_OPENAPI_URL to point at another country (e.g. ...shopee.vn/graphql).
export const SHOPEE_OPENAPI_DEFAULT_URL =
  process.env.SHOPEE_OPENAPI_URL || 'https://open-api.affiliate.shopee.com.my/graphql';
export const SHOPEE_DEFAULT_REGION = 'my';

let _explicit = {};   // { appId, secret, url }
let _pool = null;     // optional pg.Pool used to read secrets from the `settings` table

export function configureShopee(cfg = {}) {
  _explicit = { ..._explicit, ...cfg };
  return _explicit;
}

/** Register a pg.Pool so credentials can be read from the `settings` table (repo convention). */
export function registerShopeePool(pool) {
  _pool = pool;
}

async function readSetting(key) {
  if (!_pool) return null;
  try {
    const { rows } = await _pool.query('SELECT value FROM settings WHERE key=$1', [key]);
    const raw = rows[0]?.value;
    if (raw == null) return null;
    if (typeof raw === 'string') return raw;
    if (raw && typeof raw === 'object') return raw.v ?? raw.value ?? raw.secret ?? raw.app_id ?? null;
    return null;
  } catch {
    return null;
  }
}

export async function getShopeeConfig() {
  const appId = _explicit.appId ?? process.env.SHOPEE_API_APP_ID ?? (await readSetting('shopee_app_id'));
  const secret = _explicit.secret ?? process.env.SHOPEE_API_SECRET ?? (await readSetting('shopee_app_secret'));
  const url = _explicit.url ?? process.env.SHOPEE_OPENAPI_URL ?? SHOPEE_OPENAPI_DEFAULT_URL;
  return { appId: appId || '', secret: secret || '', url };
}

export async function isConfigured() {
  const { appId, secret } = await getShopeeConfig();
  return Boolean(appId && secret);
}

// ─────────────────────────────────────────── errors
export class ShopeeNotConfigured extends Error {
  constructor() {
    super('Shopee Open API not configured (set SHOPEE_API_APP_ID / SHOPEE_API_SECRET, or a settings row).');
    this.name = 'ShopeeNotConfigured';
  }
}
export class ShopeeApiError extends Error {
  constructor(message, code, extra = {}) {
    super(message || 'Shopee API error');
    this.name = 'ShopeeApiError';
    this.code = code ?? null;
    this.extra = extra;
  }
}

// ─────────────────────────────────────────── auth
/** Build the `Authorization` header exactly as Shopee expects. */
export function buildAuthorization(appId, secret, payload, timestamp) {
  const signature = crypto
    .createHash('sha256')
    .update(`${appId}${timestamp}${payload}${secret}`)
    .digest('hex');
  return `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`;
}

// ─────────────────────────────────────────── low-level call
/**
 * POST a GraphQL query to the Shopee Affiliate Open API.
 * @param {string} query        a GraphQL document (query or mutation)
 * @param {{variables?:object, appId?:string, secret?:string, url?:string}} [opts]
 * @returns {Promise<any>} the `data` field of the response
 */
export async function callShopee(query, { variables, appId, secret, url } = {}) {
  const cfg = await getShopeeConfig();
  const a = appId ?? cfg.appId;
  const s = secret ?? cfg.secret;
  const u = url ?? cfg.url;
  if (!a || !s) throw new ShopeeNotConfigured();

  // The signature is computed over the EXACT request body string, so we build it once
  // and send that same string verbatim (fetch does not re-serialize a string body).
  const payload = JSON.stringify(variables ? { query, variables } : { query });
  const timestamp = Math.floor(Date.now() / 1000);
  const authorization = buildAuthorization(a, s, payload, timestamp);

  const res = await fetch(u, {
    method: 'POST',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: payload,
    signal: AbortSignal.timeout(20_000),
  });

  const json = await res.json().catch(() => ({}));
  if (Array.isArray(json.errors) && json.errors.length) {
    const e = json.errors[0];
    throw new ShopeeApiError(e.message || 'Shopee API error', e.extensions?.code, e);
  }
  return json.data ?? null;
}

// ─────────────────────────────────────────── GraphQL query builders
// GraphQL string literals are double-quoted and JSON.stringify produces exactly that,
// so it is a safe way to embed a controlled string (escapes quotes/backslashes).
const gqlStr = (s) => JSON.stringify(String(s ?? ''));
const int = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
};

/** Parse a Shopee item id out of any product URL (full, short, or /i.<shop>.<item> form). */
export function parseItemIdFromUrl(url) {
  try {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname);
    let m = path.match(/\/i\.(\d+)\.(\d+)/i) || path.match(/\/product\/(\d+)\/(\d+)/i);
    if (m) return Number(m[2]);
    m = path.match(/\.(\d+)\.(\d+)(?:[-/?#]|$)/);
    if (m) return Number(m[2]);
    const q = u.searchParams.get('item_id') || u.searchParams.get('itemId');
    if (q && /^\d+$/.test(q)) return Number(q);
    return null;
  } catch {
    return null;
  }
}

export function productOfferQuery(opts = {}) {
  const f = [];
  if (opts.itemId) f.push(`itemId: ${int(opts.itemId)}`);
  if (opts.shopId) f.push(`shopId: ${int(opts.shopId)}`);
  if (opts.keyword) f.push(`keyword: ${gqlStr(opts.keyword)}`);
  if (opts.listType != null) f.push(`listType: ${int(opts.listType)}`);
  if (opts.sortType != null) f.push(`sortType: ${int(opts.sortType)}`);
  f.push(`page: ${int(opts.page ?? 1)}`);
  f.push(`limit: ${int(opts.limit ?? 10)}`);
  return `{
  productOfferV2(${f.join(', ')}) {
    nodes {
      itemId commissionRate sellerCommissionRate shopeeCommissionRate
      commission sales priceMin priceMax ratingStar
      imageUrl productName shopId shopName productLink offerLink
    }
    pageInfo { page limit hasNextPage }
  }
}`;
}

export function conversionReportQuery(opts = {}) {
  const f = [];
  if (opts.purchaseTimeStart) f.push(`purchaseTimeStart: ${int(opts.purchaseTimeStart)}`);
  if (opts.purchaseTimeEnd) f.push(`purchaseTimeEnd: ${int(opts.purchaseTimeEnd)}`);
  if (opts.completeTimeStart) f.push(`completeTimeStart: ${int(opts.completeTimeStart)}`);
  if (opts.completeTimeEnd) f.push(`completeTimeEnd: ${int(opts.completeTimeEnd)}`);
  if (opts.shopName) f.push(`shopName: ${gqlStr(opts.shopName)}`);
  if (opts.productName) f.push(`productName: ${gqlStr(opts.productName)}`);
  if (opts.orderStatus) f.push(`orderStatus: ${gqlStr(opts.orderStatus)}`);
  if (opts.scrollId) f.push(`scrollId: ${gqlStr(opts.scrollId)}`);
  f.push(`limit: ${int(opts.limit ?? 200)}`);
  return `{
  conversionReport(${f.join(', ')}) {
    nodes {
      conversionId purchaseTime clickTime totalCommission netCommission
      shopeeCommissionCapped sellerCommission utmContent device referrer
      orders {
        orderId orderStatus shopType
        items { shopId shopName itemId itemName itemPrice qty itemTotalCommission actualAmount }
      }
    }
    pageInfo { scrollId }
  }
}`;
}

export function validatedReportQuery(opts = {}) {
  const f = [];
  f.push(`validationId: ${int(opts.validationId)}`);
  if (opts.scrollId) f.push(`scrollId: ${gqlStr(opts.scrollId)}`);
  f.push(`limit: ${int(opts.limit ?? 200)}`);
  return `{
  validatedReport(${f.join(', ')}) {
    nodes {
      conversionId purchaseTime clickTime totalCommission netCommission
      shopeeCommissionCapped sellerCommission utmContent device referrer
      orders {
        orderId orderStatus shopType
        items { shopId shopName itemId itemName itemPrice qty itemTotalCommission actualAmount }
      }
    }
    pageInfo { scrollId }
  }
}`;
}

// ─────────────────────────────────────────── typed wrappers
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function searchProductOffers(opts = {}) {
  const data = await callShopee(productOfferQuery(opts));
  return data?.productOfferV2?.nodes ?? [];
}

/** Best-effort product lookup: by item id parsed from the URL, else by keyword (product name). */
export async function getProductOfferByUrl(url, opts = {}) {
  const itemId = parseItemIdFromUrl(url);
  const base = itemId ? { itemId, limit: 1 } : (opts.keyword ? { keyword: opts.keyword, limit: 5 } : {});
  const nodes = await searchProductOffers({ ...base, ...opts, limit: opts.limit ?? (itemId ? 1 : 5) });
  return nodes[0] ?? null;
}

export async function generateShortLink({ originUrl, subIds = [] } = {}) {
  const query =
    `mutation { generateShortLink(input: { originUrl: ${gqlStr(originUrl)}, ` +
    `subIds: [${subIds.map(gqlStr).join(', ')}] }) { shortLink } }`;
  const data = await callShopee(query);
  return data?.generateShortLink?.shortLink ?? null;
}

export async function getConversions(opts = {}) {
  const data = await callShopee(conversionReportQuery(opts));
  return { nodes: data?.conversionReport?.nodes ?? [], pageInfo: data?.conversionReport?.pageInfo ?? {} };
}

export async function getValidatedReport(opts = {}) {
  const data = await callShopee(validatedReportQuery(opts));
  return { nodes: data?.validatedReport?.nodes ?? [], pageInfo: data?.validatedReport?.pageInfo ?? {} };
}

/**
 * Enrich a product from the Shopee Affiliate Open API. Returns {ok:false,...} on any
 * failure so callers can fall back to scraping. Never throws.
 */
export async function enrichProductFromShopee(affiliateUrl, { name } = {}) {
  if (!(await isConfigured())) return { ok: false, reason: 'not_configured' };
  try {
    const itemId = parseItemIdFromUrl(affiliateUrl);
    const opts = itemId
      ? { itemId, limit: 1, sortType: 5 }
      : (name ? { keyword: name, limit: 5, sortType: 5 } : null);
    if (!opts) return { ok: false, reason: 'no_itemid_or_name' };

    const node = (await searchProductOffers(opts))[0];
    if (!node) return { ok: false, reason: 'no_match' };

    return {
      ok: true,
      source: 'shopee_openapi',
      item_id: num(node.itemId),
      name: node.productName ?? null,
      price_min: num(node.priceMin),
      price_max: num(node.priceMax),
      commission_rate: node.commissionRate ?? null,
      commission: num(node.commission),
      sales: num(node.sales),
      rating: node.ratingStar ?? null,
      image_url: node.imageUrl ?? null,
      offer_link: node.offerLink ?? null,
      product_link: node.productLink ?? null,
    };
  } catch (e) {
    return { ok: false, reason: e instanceof ShopeeApiError ? `api_error:${e.code}` : e.message };
  }
}
