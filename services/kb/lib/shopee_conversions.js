/**
 * Shopee conversion ingest — the "wf5" piece that was previously "Apify / manual CSV".
 *
 * Pulls order data from the Shopee Affiliate Open API and upserts it into the existing
 * `conversions` table. The join key is the affiliate sub_id, which Shopee returns as
 * `utmContent` on each conversion node. The redirector already appends `sub_id=<post.uid>`
 * to every click, so `utmContent` == `post.uid` and we map straight onto `conversions.post_uid`.
 *
 * Amounts (gmv / commission) are stored in the account's LOCAL currency (RM for MY), in the
 * currency-neutral `gmv_minor` / `commission_minor` columns added by migration 002. Historical
 * `*_idr` names are generated read-only mirrors and must not be INSERTed into.
 */

import { getConversions, getValidatedReport, isConfigured } from './shopee.js';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const toDate = (sec) => (sec ? new Date(Number(sec) * 1000) : null);
const toStatus = (s) => (s ? String(s).toLowerCase() : 'pending');

/**
 * Flatten Shopee conversion nodes into rows shaped for the `conversions` table.
 * One row per order (order_id is UNIQUE); a conversion with no orders becomes a single
 * pending row keyed by conversionId.
 */
export function mapConversionNodes(nodes = []) {
  const rows = [];
  for (const node of nodes) {
    const post_uid = node.utmContent || null;
    const orders = node.orders || [];

    if (orders.length === 0) {
      rows.push({
        post_uid,
        order_id: String(node.conversionId),
        order_ts: toDate(node.purchaseTime),
        item_name: null,
        gmv: null,
        commission: num(node.totalCommission),
        status: 'pending',
      });
      continue;
    }

    for (const order of orders) {
      const items = order.items || [];
      const gmv =
        items.reduce((s, it) => s + (num(it.actualAmount) || 0), 0) ||
        num(order.actualAmount) ||
        null;
      const itemCommission = items.reduce(
        (sum, item) => sum + (num(item.itemTotalCommission) || 0),
        0,
      );
      rows.push({
        post_uid,
        order_id: String(order.orderId),
        order_ts: toDate(node.purchaseTime),
        item_name: items[0]?.itemName ?? null,
        gmv,
        // Commission is an item field in conversionReport. Using the conversion total for
        // every order duplicated commission whenever one conversion contained several orders.
        commission: itemCommission || num(order.itemTotalCommission) ||
          (orders.length === 1 ? num(node.totalCommission) : null),
        status: toStatus(order.orderStatus),
      });
    }
  }
  return rows;
}

/** Idempotent upsert on order_id. Returns counts of inserts vs updates. */
export async function upsertConversionRows(pool, rows = []) {
  let inserted = 0;
  let updated = 0;
  if (!rows.length) return { inserted, updated };

  await pool.query('BEGIN');
  try {
    for (const r of rows) {
      const { rows: [row] } = await pool.query(
        `INSERT INTO conversions
           (post_uid, order_id, order_ts, item_name, gmv_minor, commission_minor, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (order_id) DO UPDATE SET
           post_uid          = COALESCE(EXCLUDED.post_uid, conversions.post_uid),
           order_ts          = COALESCE(EXCLUDED.order_ts, conversions.order_ts),
           item_name         = COALESCE(EXCLUDED.item_name, conversions.item_name),
           gmv_minor         = COALESCE(EXCLUDED.gmv_minor, conversions.gmv_minor),
           commission_minor  = COALESCE(EXCLUDED.commission_minor, conversions.commission_minor),
           status            = COALESCE(EXCLUDED.status, conversions.status),
           ingested_at       = now()
         RETURNING (xmax = 0) AS inserted`,
        [
          r.post_uid ?? null,
          r.order_id,
          r.order_ts ?? null,
          r.item_name ?? null,
          r.gmv ?? null,
          r.commission ?? null,
          r.status ?? 'pending',
        ],
      );
      if (row?.inserted) inserted++;
      else updated++;
    }
    await pool.query('COMMIT');
  } catch (e) {
    await pool.query('ROLLBACK').catch(() => {});
    throw e;
  }
  return { inserted, updated };
}

/**
 * Pull conversions from the Open API for the last `lookbackDays` and upsert them.
 * Pagination uses scrollId (valid 30s — we chain pages with no delay, which stays well
 * inside the window). `includeValidated` pulls the billing-validated report too (needs
 * a `validationId`, found in Billing Information on the affiliate dashboard).
 */
export async function pullConversions({
  pool,
  lookbackDays = 7,
  includeValidated = false,
  validationId = null,
  limit = 200,
} = {}) {
  // Conversion import is an optional learning signal. A first-time deployment commonly has
  // no Affiliate Open API credentials, and must not fail its scheduled job or touch the DB.
  if (!(await isConfigured())) {
    return { fetched: 0, rows: 0, inserted: 0, updated: 0, skipped: 'not_configured' };
  }

  const now = Math.floor(Date.now() / 1000);
  const start = now - Math.max(1, lookbackDays) * 86400;

  let all = [];
  let page = await getConversions({ purchaseTimeStart: start, purchaseTimeEnd: now, limit });
  all = all.concat(page.nodes);
  let scrollId = page.pageInfo?.scrollId;
  while (scrollId) {
    page = await getConversions({ scrollId, limit });
    all = all.concat(page.nodes);
    scrollId = page.pageInfo?.scrollId;
  }

  if (includeValidated && validationId) {
    let v = await getValidatedReport({ validationId, limit });
    all = all.concat(v.nodes);
    let vScroll = v.pageInfo?.scrollId;
    while (vScroll) {
      v = await getValidatedReport({ validationId, scrollId: vScroll, limit });
      all = all.concat(v.nodes);
      vScroll = v.pageInfo?.scrollId;
    }
  }

  const rows = mapConversionNodes(all);
  const { inserted, updated } = await upsertConversionRows(pool, rows);
  return { fetched: all.length, rows: rows.length, inserted, updated };
}
