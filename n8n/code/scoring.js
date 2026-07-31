/**
 * n8n Code node — wf4 scoring.
 *
 * Input $json:
 *   posts    : [{id, uid, product_uid, format, angle, tone, sell_intensity, length_band,
 *                views, likes, replies, reposts, quotes, clicks, orders, commission_idr}]
 *   settings : scoring + bandit settings
 *   lifetime_orders : integer, all-time completed orders (drives the money/engagement blend)
 *
 * Output: per-post Bayesian scores + a cycle digest payload.
 *
 * 2026 logic:
 *  - No raw cycle z-score ranking. With ~15 posts/cycle it hallucinates winners from 1 lucky
 *    click or one under-distributed post.
 *  - Every noisy post metric is shrunk toward the cycle/global baseline before ranking.
 *  - Confidence comes from intent volume. By default a post needs ~50 clicks before its own
 *    CTR/EPM fully overrides the prior.
 */

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function safeDiv(n, d, fallback = 0) {
  return d ? n / d : fallback;
}

function bayesAverage(actual, prior, evidence, priorWeight) {
  const e = Math.max(num(evidence), 0);
  const c = Math.max(num(priorWeight, 50), 0);
  if (e + c === 0) return actual;
  return ((e * actual) + (c * prior)) / (e + c);
}

function logLift(value, baseline, floor = 1e-9) {
  // Log lift is smoother than raw ratios and cannot explode when the baseline is tiny.
  return Math.log((Math.max(value, 0) + floor) / (Math.max(baseline, 0) + floor));
}

function zscores(values) {
  // Kept only for backwards-compatible observability in post_scores.z_* columns.
  // The final score does NOT use these values anymore.
  const n = values.length;
  if (n === 0) return [];
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n) || 1;
  return values.map(v => (v - mean) / sd);
}

function score(input) {
  const posts = input.posts ?? [];
  const settings = input.settings ?? {};
  const s = settings.scoring ?? {};
  const ew = s.eng_weights ?? { likes: 1, replies: 3, reposts: 5, quotes: 4 };
  const MIN_VIEWS = s.min_views ?? 200;
  const PRIOR_CLICKS = s.bayesian_prior_clicks ?? s.shrinkage_clicks ?? settings.bandit?.bayesian_prior_clicks ?? 50;
  const PRIOR_VIEWS = s.bayesian_prior_views ?? 500;

  const rows = posts.map(p => {
    const views = Math.max(num(p.views), 0);
    const clicks = Math.max(num(p.clicks), 0);
    const orders = Math.max(num(p.orders), 0);
    const comm = Math.max(num(p.commission_myr ?? p.commission_minor ?? p.commission_idr), 0);
    const likes = Math.max(num(p.likes), 0);
    const replies = Math.max(num(p.replies), 0);
    const reposts = Math.max(num(p.reposts), 0);
    const quotes = Math.max(num(p.quotes), 0);

    const weightedEng = ew.likes * likes + ew.replies * replies + ew.reposts * reposts + ew.quotes * quotes;
    const ctr = safeDiv(clicks, views);
    const eng = safeDiv(weightedEng, views);
    const cvr = safeDiv(orders, clicks);
    const epm = views ? (comm / views) * 1000 : 0;

    return { post: p, views, clicks, orders, comm, weightedEng, ctr, eng, cvr, epm, eligible: views >= MIN_VIEWS };
  });

  const totals = rows.reduce((acc, r) => ({
    views: acc.views + r.views,
    clicks: acc.clicks + r.clicks,
    orders: acc.orders + r.orders,
    commission: acc.commission + r.comm,
    weightedEng: acc.weightedEng + r.weightedEng,
  }), { views: 0, clicks: 0, orders: 0, commission: 0, weightedEng: 0 });

  // Cycle-level priors. If the current cycle is tiny, these can be replaced by workflow-provided
  // historical priors in settings.scoring.global_* without changing the Code node contract.
  const globalCtr = num(s.global_ctr, safeDiv(totals.clicks, totals.views));
  const globalEng = num(s.global_eng, safeDiv(totals.weightedEng, totals.views));
  const globalCvr = num(s.global_cvr, safeDiv(totals.orders, totals.clicks));
  const globalEpm = num(s.global_epm, totals.views ? (totals.commission / totals.views) * 1000 : 0);

  for (const r of rows) {
    // User-requested shrinkage shape:
    // Adjusted = ((Total_Clicks * PostMetric) + (C * GlobalMetric)) / (Total_Clicks + C)
    // We apply it to CTR and EPM; engagement uses views as its evidence because likes/replies
    // can exist without affiliate clicks.
    r.bayes_ctr = bayesAverage(r.ctr, globalCtr, r.clicks, PRIOR_CLICKS);
    r.bayes_epm = bayesAverage(r.epm, globalEpm, r.clicks, PRIOR_CLICKS);
    r.bayes_cvr = bayesAverage(r.cvr, globalCvr, r.clicks, PRIOR_CLICKS);
    r.bayes_eng = bayesAverage(r.eng, globalEng, r.views, PRIOR_VIEWS);

    // Convert shrunk metrics into smooth lifts vs the baseline. These are stable enough for the
    // bandit but still reward posts that are genuinely above account average.
    const ctrLift = logLift(r.bayes_ctr, globalCtr, 0.0001);
    const engLift = logLift(r.bayes_eng, globalEng, 0.0001);
    const epmLift = globalEpm > 0
      ? logLift(r.bayes_epm, globalEpm, 0.01)
      // Before there is any commission signal, use shrunk CVR as a small intent proxy.
      : 0.5 * logLift(r.bayes_cvr, globalCvr, 0.0001);

    r.eng_score = (num(s.w_ctr, 0.25) * ctrLift + num(s.w_eng, 0.20) * engLift) /
                  (num(s.w_ctr, 0.25) + num(s.w_eng, 0.20));
    r.money_score = (num(s.w_epm, 0.55) * epmLift) + (0.10 * logLift(r.bayes_cvr, globalCvr, 0.0001));

    // Trust money only as fast as money data accumulates, but rank the money component by the
    // Bayesian EPM posterior rather than raw EPM.
    const target = settings.bandit?.money_shrinkage_target_orders ?? 20;
    const wMoney = Math.min(1, (num(input.lifetime_orders) || 0) / target);
    const wHuman = 0.15;
    const humanScore = num(p.human_score, 0); // +1 approved/edited, -1 rejected, 0 default/auto
    r.human_score = humanScore;
    const wEng = Math.max(0, 1 - wMoney - wHuman);
    r.final_score = clamp(wMoney * r.money_score + wEng * r.eng_score + wHuman * r.human_score, -3, 3);

    // Under-distributed posts remain low-confidence. They may be good, but the algorithm did not
    // give them enough reach to certify a winner.
    if (!r.eligible) r.final_score = Math.min(r.final_score, -0.35);
  }

  const zCtr = zscores(rows.map(r => r.bayes_ctr));
  const zEng = zscores(rows.map(r => r.bayes_eng));
  const zEpm = zscores(rows.map(r => r.bayes_epm));
  rows.forEach((r, i) => { r.z_ctr = zCtr[i]; r.z_eng = zEng[i]; r.z_epm = zEpm[i]; });

  const sorted = [...rows].sort((a, b) => b.final_score - a.final_score);
  const nWin = Math.max(1, Math.ceil(sorted.length * (settings.bandit?.winner_top_pct ?? 0.2)));
  const nLose = Math.max(1, Math.floor(sorted.length * (settings.bandit?.loser_bottom_pct ?? 0.3)));
  sorted.forEach((r, i) => {
    r.verdict = i < nWin ? 'winner' : (i >= sorted.length - nLose ? 'loser' : 'neutral');
  });

  // ── marginal lever report (this is the part a human should read)
  const kinds = ['format', 'angle', 'tone', 'sell_intensity', 'length_band', 'media_type'];
  const cycleMean = rows.reduce((a, r) => a + r.final_score, 0) / (rows.length || 1);
  const leverReport = {};
  for (const kind of kinds) {
    const byCode = {};
    for (const r of rows) {
      const c = String(r.post[kind] ?? '');
      if (!c) continue;
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
    if (Number.isFinite(h)) (byHour[h] ??= []).push(r.final_score);
  }
  const hourReport = Object.entries(byHour).map(([h, v]) => ({
    hour: Number(h), n: v.length, mean_score: v.reduce((a, b) => a + b, 0) / v.length,
  })).sort((a, b) => b.mean_score - a.mean_score);

  const wMoney = rows[0]?.w_money ?? Math.min(1, (num(input.lifetime_orders) || 0) / (settings.bandit?.money_shrinkage_target_orders ?? 20));

  return {
    // Pass-through fields keep the wf4 chain self-contained: the next Code nodes need the
    // previous bandit/technique state after scoring has replaced the payload.
    settings,
    prev_arm_stats: input.prev_arm_stats ?? input.arm_stats ?? [],
    prev_context_weights: input.prev_context_weights ?? input.context_weights ?? [],
    prev_techniques: input.prev_techniques ?? [],
    prev: input.prev_techniques ?? [],
    usage: input.usage ?? [],
    w_money: wMoney,
    bayesian_prior_clicks: PRIOR_CLICKS,
    global_ctr: globalCtr,
    global_eng: globalEng,
    global_cvr: globalCvr,
    global_epm: globalEpm,
    scores: rows.map(r => ({
      post_id: r.post.id, post: r.post,
      ctr: r.ctr, eng: r.eng, cvr: r.cvr, epm: r.epm,
      bayes_ctr: r.bayes_ctr, bayes_eng: r.bayes_eng, bayes_cvr: r.bayes_cvr, bayes_epm: r.bayes_epm,
      adjusted_score: r.bayes_epm,
      z_ctr: r.z_ctr, z_eng: r.z_eng, z_epm: r.z_epm,
      money_score: r.money_score, eng_score: r.eng_score,
      final_score: r.final_score, verdict: r.verdict,
    })),
    lever_report: leverReport,
    hour_report: hourReport,
    totals: { views: totals.views, clicks: totals.clicks, orders: totals.orders, commission: totals.commission },
    ctr_pct: totals.views ? (totals.clicks / totals.views) * 100 : 0,
    cvr_pct: totals.clicks ? (totals.orders / totals.clicks) * 100 : 0,
  };
}

return [{ json: score($json) }];
