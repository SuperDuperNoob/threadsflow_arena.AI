import { runApifyActor } from './apify_shopee.js';
const validSort = new Set(['sales','relevancy','newest','price_asc','price_desc']);
const n = v => Number.isFinite(Number(v)) ? Number(v) : null;
const score = r => Math.round(Math.min(100, (r.rating ?? 0) * 12 + Math.min(25, Math.log10((r.sold_count ?? 0) + 1) * 7) + Math.min(15, (r.discount_pct ?? 0) / 2) + (r.is_mall ? 5 : 0)));
export async function searchTrendingProducts({ keyword, sort = 'sales', maxProducts = 20 } = {}) {
  const q = String(keyword ?? '').trim();
  if (q.length < 2 || q.length > 80) return { ok: false, reason: 'invalid_keyword' };
  if (!validSort.has(sort)) return { ok: false, reason: 'invalid_sort' };
  const max = Math.max(1, Math.min(20, Number(maxProducts) || 20));
  const out = await runApifyActor('xtracto~shopee-search', { country: 'my', mode: 'keyword', keyword: q, sort, maxProducts: max, fetchDetail: false, delay: 1 });
  if (!out.ok) return out;
  const candidates = (Array.isArray(out.data) ? out.data : []).map(x => {
    const item = { shop_id:n(x.shop_id), item_id:n(x.item_id), product_url:x.url ?? null, title:x.name ?? x.title ?? null, image_url:x.image_url ?? null, currency:x.currency ?? 'MYR', price:n(x.price), original_price:n(x.original_price), discount_pct:n(x.discount_pct), rating:n(x.rating ?? x.rating_star), rating_count:n(x.rating_count ?? x.total_ratings), sold_count:n(x.sold_count ?? x.sold), location:x.location ?? x.shop_location ?? null, is_mall:Boolean(x.is_mall) };
    if (!item.product_url && item.shop_id && item.item_id) item.product_url = `https://shopee.com.my/product/${item.shop_id}/${item.item_id}`;
    return { ...item, opportunity_score: score(item) };
  }).filter(x => x.product_url && x.item_id && x.shop_id);
  return { ok: true, keyword:q, sort, maxProducts:max, candidates };
}
