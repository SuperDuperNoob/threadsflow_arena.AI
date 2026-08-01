/** Optional Apify client shared by product enrichment and discovery. */
const DEFAULT_PER_KEY_MONTHLY_RUNS = 25;
const TIMEOUT_MS = 45_000;
let _explicit = {}, _pool = null;
const nonBlank = v => typeof v === 'string' ? v.trim() : v;
export function configureApify(cfg = {}) { _explicit = { ..._explicit, ...cfg }; return _explicit; }
export function registerApifyPool(pool) { _pool = pool; }

async function legacyToken() {
  if (_explicit.token) return nonBlank(_explicit.token);
  if (process.env.APIFY_TOKEN) return nonBlank(process.env.APIFY_TOKEN);
  if (!_pool) return '';
  try { const { rows } = await _pool.query("SELECT value FROM settings WHERE key='apify_token'"); const v = rows[0]?.value; return nonBlank(typeof v === 'string' ? v : v?.secret ?? v?.value); } catch { return ''; }
}
function limit() { const n = Number(_explicit.monthlyMaxRuns ?? process.env.APIFY_MONTHLY_MAX_RUNS); return Number.isInteger(n) && n > 0 ? Math.min(n, DEFAULT_PER_KEY_MONTHLY_RUNS) : DEFAULT_PER_KEY_MONTHLY_RUNS; }

async function keys() {
  if (_pool) {
    try { const { rows } = await _pool.query(`SELECT id,label,token FROM apify_api_keys WHERE active AND (disabled_until IS NULL OR disabled_until < now()) ORDER BY priority,id`); const usable=rows.filter(k=>nonBlank(k.token)); if (usable.length) return usable; } catch { /* migration absent: legacy only */ }
  }
  const token = await legacyToken();
  return token ? [{ id: null, label: 'environment/legacy', token }] : [];
}
export async function getApifyAvailability() {
  const available = await keys();
  return { configured: available.length > 0, missing: available.length ? [] : ['token'], actor: 'chartedsea/shopee-api-scraper', active_keys: available.map(k => ({ id: k.id, label: k.label })), per_key_monthly_run_cap: limit() };
}
export function parseShopeeProductIds(value) {
  try { const u = new URL(value); if (!/(^|\.)shopee\.(com\.my|sg|co\.id|co\.th|ph|vn|tw)$/i.test(u.hostname)) return null; const p = decodeURIComponent(u.pathname); const m = p.match(/\/product\/(\d+)\/(\d+)/i) || p.match(/(?:^|\.)i\.(\d+)\.(\d+)(?:[-/?#]|$)/i) || p.match(/\.(\d+)\.(\d+)(?:[-/?#]|$)/); return m ? { shopId: Number(m[1]), itemId: Number(m[2]) } : null; } catch { return null; }
}
async function reserve(key) {
  if (!key.id) return { ok: true }; // legacy env token is backwards compatible; DB keys are strongly budgeted.
  if (!_pool) return { ok: false, reason: 'usage_store_unavailable' };
  const { rows } = await _pool.query(`INSERT INTO apify_key_monthly_usage(key_id,month,runs) VALUES($1,date_trunc('month',now())::date,1) ON CONFLICT(key_id,month) DO UPDATE SET runs=apify_key_monthly_usage.runs+1 WHERE apify_key_monthly_usage.runs < $2 RETURNING runs`, [key.id, limit()]);
  return rows[0] ? { ok: true } : { ok: false, reason: 'key_monthly_limit_reached' };
}
async function disableQuotaKey(key) { if (key.id && _pool) await _pool.query("UPDATE apify_api_keys SET disabled_until=date_trunc('month',now()) + interval '1 month', updated_at=now() WHERE id=$1", [key.id]).catch(() => {}); }

/** Run an actor using the first usable key. 402/429/401 rotate to the next key. */
export async function runApifyActor(actor, input) {
  const candidates = await keys();
  if (!candidates.length) return { ok: false, reason: 'not_configured' };
  let last = 'key_monthly_limit_reached';
  for (const key of candidates) {
    const r = await reserve(key); if (!r.ok) { last = r.reason; continue; }
    try {
      const response = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items`, { method: 'POST', headers: { Authorization: `Bearer ${key.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(TIMEOUT_MS) });
      const data = await response.json().catch(() => null);
      if (response.ok) return { ok: true, data, keyLabel: key.label };
      last = `api_error:${response.status}`;
      if ([401, 402, 429].includes(response.status)) { await disableQuotaKey(key); continue; }
      return { ok: false, reason: last };
    } catch (e) { last = e?.name === 'TimeoutError' ? 'timeout' : 'request_failed'; }
  }
  return { ok: false, reason: last };
}
const num = v => Number.isFinite(Number(v)) ? Number(v) : null;
const clean = (v, n = 2000) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) || null : null;
const image = v => !v ? null : /^https?:/i.test(v) ? v : `https://down-my.img.susercontent.com/file/${v}`;
function map(row, ids) { const d=row?.data??row??{}, i=d.item??d; if (!i || typeof i !== 'object') return null; const money=v=>v!=null&&Math.abs(v)>100000?v/100000:v; const images=(Array.isArray(i.images)?i.images:(i.image?[i.image]:[])).map(image).filter(Boolean).slice(0,12); const reviews=(d.product_review?.ratings??d.ratings??[]).map(x=>clean(x.comment,280)).filter(Boolean).slice(0,3); return { ok:true,source:'apify_chartedsea',item_id:num(i.item_id??i.itemid??ids.itemId),shop_id:num(i.shop_id??i.shopid??ids.shopId),name:clean(i.title??i.name),description:clean(i.description,6000),price_min:money(num(i.price_min??i.price)),price_max:money(num(i.price_max??i.price)),rating:num(d.product_review?.rating_star??i.rating_star),rating_count:num(d.product_review?.rating_count),sales:num(i.historical_sold??i.sold),image_url:images[0]??null,images,categories:(i.fe_categories??[]).map(x=>clean(x.display_name??x.name,120)).filter(Boolean),seller:{name:clean(d.shop_detailed?.name),username:clean(d.shop_detailed?.username),rating:num(d.shop_detailed?.rating_star)},variants:(i.models??[]).slice(0,30).map(x=>({name:clean(x.name,180),price:money(num(x.price)),stock:num(x.stock)})),top_reviews:reviews }; }
export async function enrichProductFromApify(productUrl) { const ids=parseShopeeProductIds(productUrl); if (!ids) return {ok:false,reason:'no_product_ids'}; const input={requests:[{url:`https://shopee.com.my/api/v4/pdp/get_pc?shop_id=${ids.shopId}&item_id=${ids.itemId}`}],productDetail_mode:'FROM_CACHE_AND_CORRECTED',productDetail_crawlProductRatings:['WITH_COMMENTS'],productRatings_enrichUrlQuery_pageSize:10,productRatings_crawlNextPages:false,productRatings_crawlNextPages_maxResults:10}; const out=await runApifyActor('chartedsea~shopee-api-scraper',input); return out.ok ? (map(out.data?.[0],ids) ?? {ok:false,reason:'empty_result'}) : out; }
