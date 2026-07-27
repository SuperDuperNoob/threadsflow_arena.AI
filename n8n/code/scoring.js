/**
 * n8n Code node — wf4 scoring.
 *
 * Input $json:
 *   posts    : [{id, uid, product_uid, format, angle, tone, sell_intensity, length_band,
 *                views, likes, replies, reposts, quotes, clicks, orders, commission_idr}]
 *   settings : scoring + bandit settings
 *   lifetime_orders : integer, all-time completed orders (drives the shrinkage weight)
 *
 * Output: per-post scores + a cycle digest payload.
 *
 * Design notes:
 *  - Everything is z-scored WITHIN the cycle. Absolute numbers drift with follower count,
 *    seasonality and Threads' ranking changes; relative ranking inside a cycle does not.
 *  - Money dominates the score, but only as fast as you actually accumulate order data.
 *    With 0 orders the score is 100% engagement; at 20 lifetime orders it's 100% money.
 *  - Posts with < 200 views are excluded from z-scoring (they poison the variance) but still
 *    get a floor score so their arms aren't rewarded.
 */

function zscores(values) {
  const n = values.length;
  if (n === 0) return [];
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n) || 1;
  return values.map(v => (v - mean) / sd);
}

function score({ posts, settings, lifetime_orders }) {
  const s = settings.scoring;
  const ew = s.eng_weights;
  const MIN_VIEWS = 200;

  const rows = posts.map(p => {
    const views = Math.max(Number(p.views) || 0, 0);
    const clicks = Number(p.clicks) || 0;
    const orders = Number(p.orders) || 0;
    const comm = Number(p.commission_idr) || 0;

    const ctr = views ? clicks / views : 0;
    const eng = views
      ? (ew.likes * p.likes + ew.replies * p.replies + ew.reposts * p.reposts + ew.quotes * p.quotes) / views
      : 0;
    const cvr = clicks ? orders / clicks : 0;
    const epm = views ? (comm / views) * 1000 : 0;

    return { post: p, views, ctr, eng, cvr, epm, eligible: views >= MIN_VIEWS };
  });

  const elig = rows.filter(r => r.eligible);
  const pool = elig.length >= 4 ? elig : rows;   // fall back if the cycle was tiny

  const zCtr = zscores(pool.map(r => r.ctr));
  const zEng = zscores(pool.map(r => r.eng));
  const zEpm = zscores(pool.map(r => r.epm));
  pool.forEach((r, i) => { r.z_ctr = zCtr[i]; r.z_eng = zEng[i]; r.z_epm = zEpm[i]; });
  rows.forEach(r => { r.z_ctr ??= -1.5; r.z_eng ??= -1.5; r.z_epm ??= -1.5; });

  // shrinkage: trust money only as fast as money data accumulates
  const target = settings.bandit.money_shrinkage_target_orders ?? 20;
  const wMoney = Math.min(1, (Number(lifetime_orders) || 0) / target);

  for (const r of rows) {
    // money score: EPM is the north star; CVR breaks ties between equal-EPM posts
    r.money_score = 0.75 * r.z_epm + 0.25 * (r.cvr > 0 ? 1 : -0.2);
    // engagement score: CTR weighted higher than raw engagement — a like doesn't pay rent,
    // a click is the closest free proxy for intent.
    r.eng_score = (s.w_ctr * r.z_ctr + s.w_eng * r.z_eng) / (s.w_ctr + s.w_eng);
    r.final_score = wMoney * r.money_score + (1 - wMoney) * r.eng_score;
    if (!r.eligible) r.final_score = Math.min(r.final_score, -0.5); // under-distributed = weak signal
  }

  const sorted = [...rows].sort((a, b) => b.final_score - a.final_score);
  const nWin = Math.max(1, Math.ceil(sorted.length * (settings.bandit.winner_top_pct ?? 0.2)));
  const nLose = Math.max(1, Math.floor(sorted.length * (settings.bandit.loser_bottom_pct ?? 0.3)));
  sorted.forEach((r, i) => {
    r.verdict = i < nWin ? 'winner' : (i >= sorted.length - nLose ? 'loser' : 'neutral');
  });

  // ── marginal lever report (this is the part a human should read)
  const kinds = ['format', 'angle', 'tone', 'sell_intensity', 'length_band'];
  const cycleMean = rows.reduce((a, r) => a + r.final_score, 0) / (rows.length || 1);
  const leverReport = {};
  for (const kind of kinds) {
    const byCode = {};
    for (const r of rows) {
      const c = String(r.post[kind]);
      (byCode[c] ??= []).push(r.final_score);
    }
    leverReport[kind] = Object.entries(byCode)
      .map(([code, arr]) => ({
        code, n: arr.length,
        mean: arr.reduce((a, b) => a + b, 0) / arr.length,
        lift_vs_cycle: (arr.reduce((a, b) => a + b, 0) / arr.length) - cycleMean,
      }))
      .sort((a, b) => b.mean - a.mean);
  }

  // ── hour-of-day report: free extra lever you get for nothing
  const byHour = {};
  for (const r of rows) {
    const h = new Date(r.post.published_at).getHours();
    (byHour[h] ??= []).push(r.views);
  }
  const hourReport = Object.entries(byHour).map(([h, v]) => ({
    hour: Number(h), n: v.length, mean_views: v.reduce((a, b) => a + b, 0) / v.length,
  })).sort((a, b) => b.mean_views - a.mean_views);

  const totals = rows.reduce((acc, r) => ({
    views: acc.views + r.views,
    clicks: acc.clicks + (Number(r.post.clicks) || 0),
    orders: acc.orders + (Number(r.post.orders) || 0),
    commission: acc.commission + (Number(r.post.commission_idr) || 0),
  }), { views: 0, clicks: 0, orders: 0, commission: 0 });

  return {
    w_money: wMoney,
    scores: rows.map(r => ({
      post_id: r.post.id, post: r.post,
      ctr: r.ctr, eng: r.eng, cvr: r.cvr, epm: r.epm,
      z_ctr: r.z_ctr, z_eng: r.z_eng, z_epm: r.z_epm,
      money_score: r.money_score, eng_score: r.eng_score,
      final_score: r.final_score, verdict: r.verdict,
    })),
    lever_report: leverReport,
    hour_report: hourReport,
    totals,
    ctr_pct: totals.views ? (totals.clicks / totals.views) * 100 : 0,
    cvr_pct: totals.clicks ? (totals.orders / totals.clicks) * 100 : 0,
  };
}

return [{ json: score($json) }];
