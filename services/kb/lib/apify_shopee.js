/**
 * Optional Apify/Charted Sea product-content fallback.
 *
 * This is deliberately not an affiliate-data client: commissions, offer links and conversion
 * reports remain the responsibility of the official Shopee Affiliate Open API.
 * It is best-effort only and never throws into product intake.
 */

const ACTOR = 'chartedsea~shopee-api-scraper';
const ENDPOINT = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items`;
const DEFAULT_MONTHLY_MAX_RUNS = 25; // conservative: well below the advertised $5/1k request pricing
const TIMEOUT_MS = 45_000;

let _explicit = {};
let _pool = null;
const nonBlank = (value) => typeof value === 'string' ? value.trim() : value;

export function configureApify(cfg = {}) {
  _explicit = { ..._explicit, ...cfg };
  return _explicit;
}

export function registerApifyPool(pool) {
  _pool = pool;
}

async function readSetting(key) {
  if (!_pool) return null;
  try {
    const { rows } = await _pool.query('SELECT value FROM settings WHERE key=$1', [key]);
    const value = rows[0]?.value;
    if (typeof value === 'string') return value;
    return value?.v ?? value?.value ?? value?.secret ?? null;
  } catch { return null; }
}

export async function getApifyConfig() {
  const token = nonBlank(_explicit.token) || nonBlank(process.env.APIFY_TOKEN) || nonBlank(await readSetting('apify_token'));
  const configuredLimit = Number(_explicit.monthlyMaxRuns ?? process.env.APIFY_MONTHLY_MAX_RUNS);
  // This integration is deliberately free-tier-safe. The environment can lower the cap, but
  // cannot silently raise it beyond 25 runs/month; raising the hard cap needs a code review.
  const monthlyMaxRuns = Number.isInteger(configuredLimit) && configuredLimit > 0
    ? Math.min(configuredLimit, DEFAULT_MONTHLY_MAX_RUNS) : DEFAULT_MONTHLY_MAX_RUNS;
  return { token: token || '', monthlyMaxRuns };
}

export async function getApifyAvailability() {
  const { token, monthlyMaxRuns } = await getApifyConfig();
  return { configured: Boolean(token), missing: token ? [] : ['token'], actor: 'chartedsea/shopee-api-scraper', monthly_max_runs: monthlyMaxRuns };
}

/** Parse only full Shopee product pages. Affiliate short links intentionally return null. */
export function parseShopeeProductIds(value) {
  try {
    const url = new URL(value);
    if (!/(^|\.)shopee\.(com\.my|sg|co\.id|co\.th|ph|vn|tw)$/i.test(url.hostname)) return null;
    const path = decodeURIComponent(url.pathname);
    let match = path.match(/\/product\/(\d+)\/(\d+)/i) || path.match(/(?:^|\.)i\.(\d+)\.(\d+)(?:[-/?#]|$)/i);
    if (!match) match = path.match(/\.(\d+)\.(\d+)(?:[-/?#]|$)/);
    if (!match) return null;
    return { shopId: Number(match[1]), itemId: Number(match[2]) };
  } catch { return null; }
}

async function reserveRun() {
  const { monthlyMaxRuns } = await getApifyConfig();
  // A DB-backed atomic counter makes the limit hold across KB replicas/restarts. If a legacy
  // installation has not applied the migration, fail closed rather than risking surprise bills.
  if (!_pool) return { ok: false, reason: 'usage_store_unavailable' };
  try {
    const { rows } = await _pool.query(
      `INSERT INTO apify_monthly_usage (month, runs)
       VALUES (date_trunc('month', now())::date, 1)
       ON CONFLICT (month) DO UPDATE SET runs = apify_monthly_usage.runs + 1
         WHERE apify_monthly_usage.runs < $1
       RETURNING runs`,
      [monthlyMaxRuns],
    );
    return rows[0] ? { ok: true, runs: rows[0].runs, limit: monthlyMaxRuns } : { ok: false, reason: 'monthly_limit_reached' };
  } catch { return { ok: false, reason: 'usage_store_unavailable' }; }
}

const number = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const text = (value, max = 2000) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) || null : null;

function imageUrl(value, domain = 'my') {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://down-${domain}.img.susercontent.com/file/${value}`;
}

/** Remove direct identifiers before a review can reach persistence or the copy prompt. */
function reviews(raw) {
  const list = raw?.data?.ratings ?? raw?.ratings ?? raw?.data?.product_review?.ratings ?? raw?.product_review?.ratings ?? [];
  return (Array.isArray(list) ? list : []).map((review) => text(review.comment ?? review.content, 280))
    .filter(Boolean).slice(0, 3);
}

function mapResult(row, ids) {
  const data = row?.data ?? row ?? {};
  const item = data.item ?? data.item_basic ?? data;
  if (!item || typeof item !== 'object') return null;
  const domain = 'my';
  const price = number(item.price ?? item.price_min ?? data.price);
  // Shopee low-level prices are often stored in hundred-thousandths. Do not blindly divide
  // normal MYR values; only normalize implausibly large integer minor-unit values.
  const money = (v) => v != null && Math.abs(v) > 100000 ? v / 100000 : v;
  const rawImages = item.images ?? item.image_list ?? (item.image ? [item.image] : []);
  const images = (Array.isArray(rawImages) ? rawImages : []).map((x) => imageUrl(x, domain)).filter(Boolean).slice(0, 12);
  const rating = data.product_review?.rating_star ?? item.rating_star ?? item.item_rating?.rating_star;
  const ratingCount = data.product_review?.rating_count ?? item.item_rating?.rating_count?.[0] ?? null;
  return {
    ok: true,
    source: 'apify_chartedsea',
    item_id: number(item.item_id ?? item.itemid ?? ids.itemId),
    shop_id: number(item.shop_id ?? item.shopid ?? ids.shopId),
    name: text(item.title ?? item.name),
    description: text(item.description, 6000),
    price_min: money(number(item.price_min ?? price)),
    price_max: money(number(item.price_max ?? price)),
    rating: number(rating),
    rating_count: number(ratingCount),
    sales: number(item.historical_sold ?? item.sold),
    image_url: images[0] ?? null,
    images,
    categories: (item.fe_categories ?? item.categories ?? []).map((x) => text(x?.display_name ?? x?.name, 120)).filter(Boolean).slice(0, 6),
    seller: { name: text(data.shop_detailed?.name ?? item.shop_name, 240), username: text(data.shop_detailed?.username, 120), rating: number(data.shop_detailed?.rating_star) },
    variants: (item.models ?? []).slice(0, 30).map((m) => ({ name: text(m.name, 180), price: money(number(m.price)), stock: number(m.stock) })),
    top_reviews: reviews(row),
  };
}

export async function enrichProductFromApify(productUrl) {
  const { token } = await getApifyConfig();
  if (!token) return { ok: false, reason: 'not_configured' };
  const ids = parseShopeeProductIds(productUrl);
  if (!ids) return { ok: false, reason: 'no_product_ids' };

  const usage = await reserveRun();
  if (!usage.ok) return { ok: false, reason: usage.reason };
  const input = {
    requests: [{ url: `https://shopee.com.my/api/v4/pdp/get_pc?shop_id=${ids.shopId}&item_id=${ids.itemId}` }],
    productDetail_mode: 'FROM_CACHE_AND_CORRECTED',
    productDetail_outOfStockPriceCorrectionStrategy: 'SET_NULL',
    productDetail_crawlProductRatings: ['WITH_COMMENTS'],
    productRatings_enrichUrlQuery_pageSize: 10,
    productRatings_crawlNextPages: false,
    productRatings_crawlNextPages_maxResults: 10,
  };
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, reason: `api_error:${response.status}` };
    const result = mapResult(Array.isArray(body) ? body[0] : null, ids);
    return result ?? { ok: false, reason: 'empty_result' };
  } catch (error) {
    return { ok: false, reason: error?.name === 'TimeoutError' ? 'timeout' : 'request_failed' };
  }
}
