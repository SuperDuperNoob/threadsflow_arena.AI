/**
 * n8n Code node — arm selection (wf2) and arm update (wf4).
 * Pure JS, no deps. Paste the relevant half into a Code node.
 *
 * Input for SELECT mode:
 *   $json.levers      : [{kind, code, brief, enabled}]
 *   $json.arm_stats   : [{scope, lever_kind, lever_code, alpha, beta, cooldown_until}]
 *   $json.products    : [{id, uid, name, ...}]
 *   $json.settings    : bandit settings object
 *   $json.plan        : optional {mode:'breed', parent_post_id, keep:[], mutate:''}
 */

// ───────────────────────────── helpers

// Gamma(k,1) via Marsaglia-Tsang; needed for Beta sampling.
function gammaSample(k) {
  if (k < 1) return gammaSample(k + 1) * Math.pow(Math.random(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { x = normalSample(); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
function normalSample() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function betaSample(a, b) {
  const x = gammaSample(a), y = gammaSample(b);
  return x / (x + y);
}

// ───────────────────────────── SELECT: pick one arm

/**
 * Thompson sampling over each lever independently, with epsilon-greedy exploration
 * and a product-scoped prior blended into the global prior.
 *
 * Why per-lever and not per-combo: at 5 posts/day you get 15 samples per cycle. A 6800-arm
 * combo space never converges. Marginal levers converge in ~5 cycles. Combos are only used
 * as a tie-breaker once combo_stats.n >= min_n_for_combo.
 */
function pickArm({ levers, armStats, productUid, settings, plan }) {
  const eps = settings.epsilon ?? 0.25;
  const now = Date.now();

  const statKey = (scope, kind, code) => `${scope}|${kind}|${code}`;
  const stats = new Map(armStats.map(s => [statKey(s.scope, s.lever_kind, s.lever_code), s]));

  // media_type is a real lever, but it is CONSTRAINED by what the product actually has.
  // A text-only product can never draw IMAGE; a product with images can still draw TEXT,
  // because a text post about a product you own is perfectly legitimate and often out-reaches
  // an image post on Threads. That asymmetry is deliberate.
  const kinds = ['format', 'angle', 'tone', 'sell_intensity', 'length_band', 'media_type'];
  const chosen = {};

  for (const kind of kinds) {
    // If breeding, some levers are inherited from the parent post.
    if (plan?.mode === 'breed' && plan.keep?.includes(kind)) {
      chosen[kind] = plan.parent[kind];
      continue;
    }

    let options = levers.filter(l => l.kind === kind && l.enabled);

    // Restrict media_type to what this product can physically produce.
    if (kind === 'media_type') {
      const n = plan?.imageCount ?? 0;
      const allowed = n === 0 ? ['TEXT'] : (n === 1 ? ['TEXT', 'IMAGE'] : ['TEXT', 'IMAGE', 'CAROUSEL']);
      options = options.filter(o => allowed.includes(o.code));
      // Products WITH images should still mostly use them — they were uploaded for a reason.
      // Cap pure-text at ~30% for image products so the bandit explores without overriding intent.
      if (n > 0 && options.length > 1 && Math.random() > 0.30) {
        options = options.filter(o => o.code !== 'TEXT');
      }
    }

    // drop arms in cooldown, unless that would leave nothing
    const live = options.filter(o => {
      const g = stats.get(statKey('global', kind, o.code));
      return !g?.cooldown_until || new Date(g.cooldown_until).getTime() < now;
    });
    if (live.length >= 2) options = live;

    if (Math.random() < eps) {
      // EXPLORE: uniform. Bias slightly toward least-sampled arm.
      options.sort((a, b) => {
        const na = stats.get(statKey('global', kind, a.code))?.alpha ?? 1;
        const nb = stats.get(statKey('global', kind, b.code))?.alpha ?? 1;
        return (na + Math.random() * 3) - (nb + Math.random() * 3);
      });
      chosen[kind] = options[0].code;
    } else {
      // EXPLOIT: Thompson sample. Product-scoped evidence weighted 0.6, global 0.4,
      // so a product can develop its own voice without ignoring what works site-wide.
      let best = null, bestDraw = -1;
      for (const o of options) {
        const g = stats.get(statKey('global', kind, o.code)) ?? { alpha: 1, beta: 1 };
        const p = stats.get(statKey(`product:${productUid}`, kind, o.code)) ?? { alpha: 1, beta: 1 };
        const a = 0.4 * Number(g.alpha) + 0.6 * Number(p.alpha);
        const b = 0.4 * Number(g.beta) + 0.6 * Number(p.beta);
        const draw = betaSample(Math.max(a, 0.05), Math.max(b, 0.05));
        if (draw > bestDraw) { bestDraw = draw; best = o.code; }
      }
      chosen[kind] = best;
    }
  }

  // Hard constraints that override the bandit.
  // 1. scarcity angle requires real scarcity data on the product
  if (chosen.angle === 'scarcity' && !plan?.productHasScarcityData) chosen.angle = 'social_proof';
  // 2. micro length can't carry a long format
  if (chosen.length_band === 'micro' && ['flash_story', 'diary', 'before_after'].includes(chosen.format)) {
    chosen.length_band = 'mid';
  }
  // 3. minimal/deadpan tone forbids sell_intensity 2 (reads as spam)
  if (['minimal', 'deadpan'].includes(chosen.tone) && chosen.sell_intensity === '2') {
    chosen.sell_intensity = '1';
  }
  // 4. A text-only post has no image to hold the scroll, so micro length is a bad bet:
  //    two lines with no visual is the easiest thing in a feed to skip past.
  if (chosen.media_type === 'TEXT' && chosen.length_band === 'micro') {
    chosen.length_band = 'mid';
  }

  chosen.combo_key = [chosen.format, chosen.angle, chosen.tone,
                      chosen.sell_intensity, chosen.length_band, chosen.media_type].join('|');
  return chosen;
}

/** Product choice: Thompson over product-level reward, with forced rotation for new products. */
function pickProduct({ products, productStats, settings }) {
  const fresh = products.filter(p => (p.posts_count ?? 0) < 3);
  if (fresh.length && Math.random() < 0.5) {
    // new products get guaranteed airtime before the bandit is allowed to judge them
    return fresh[Math.floor(Math.random() * fresh.length)];
  }
  let best = null, bestDraw = -1;
  for (const p of products) {
    const s = productStats.find(x => x.product_uid === p.uid) ?? { alpha: 1, beta: 1 };
    const draw = betaSample(Math.max(Number(s.alpha), 0.05), Math.max(Number(s.beta), 0.05));
    if (draw > bestDraw) { bestDraw = draw; best = p; }
  }
  return best;
}

// ───────────────────────────── UPDATE: after a cycle

/**
 * scores: [{post, final_score, verdict}]  where post has the lever fields.
 * Rewards are min-max normalized to [0,1] inside the cycle, then folded into Beta params.
 * Old evidence decays so the model tracks what the algorithm rewards *this month*.
 */
function updateArms({ scores, prevStats, settings }) {
  const decay = settings.decay ?? 0.9;
  const key = (scope, kind, code) => `${scope}|${kind}|${code}`;
  const out = new Map();

  // start from decayed previous state
  for (const s of prevStats) {
    out.set(key(s.scope, s.lever_kind, s.lever_code), {
      scope: s.scope, lever_kind: s.lever_kind, lever_code: s.lever_code,
      n: Number(s.n) * decay,
      reward_sum: Number(s.reward_sum) * decay,
      alpha: 1 + (Number(s.alpha) - 1) * decay,
      beta: 1 + (Number(s.beta) - 1) * decay,
      cooldown_until: s.cooldown_until,
    });
  }

  const vals = scores.map(s => s.final_score);
  const min = Math.min(...vals), max = Math.max(...vals);
  const norm = v => (max === min ? 0.5 : (v - min) / (max - min));

  const kinds = ['format', 'angle', 'tone', 'sell_intensity', 'length_band', 'media_type'];
  for (const s of scores) {
    const r = norm(s.final_score);            // 0..1
    for (const kind of kinds) {
      const code = String(s.post[kind] ?? '');
      if (!code) continue;
      for (const scope of ['global', `product:${s.post.product_uid}`]) {
        const k = key(scope, kind, code);
        const cur = out.get(k) ?? { scope, lever_kind: kind, lever_code: code,
                                    n: 0, reward_sum: 0, alpha: 1, beta: 1, cooldown_until: null };
        cur.n += 1;
        cur.reward_sum += r;
        cur.alpha += r;                        // fractional Beta update
        cur.beta  += (1 - r);
        out.set(k, cur);
      }
    }
  }

  // cooldown the persistent losers (global scope only, and only with enough evidence)
  const coolDays = settings.loser_cooldown_days ?? 9;
  for (const kind of kinds) {
    const arms = [...out.values()].filter(a => a.scope === 'global' && a.lever_kind === kind && a.n >= 4);
    if (arms.length < 4) continue;
    arms.sort((a, b) => (a.reward_sum / a.n) - (b.reward_sum / b.n));
    const nLosers = Math.max(1, Math.floor(arms.length * (settings.loser_bottom_pct ?? 0.3)));
    for (let i = 0; i < nLosers; i++) {
      arms[i].cooldown_until = new Date(Date.now() + coolDays * 864e5).toISOString();
    }
  }
  return [...out.values()];
}

/** Choose which winning posts to breed from next cycle. */
function planNextCycle({ scores, settings }) {
  const sorted = [...scores].sort((a, b) => b.final_score - a.final_score);
  const nWin = Math.max(1, Math.ceil(sorted.length * (settings.winner_top_pct ?? 0.2)));
  const winners = sorted.slice(0, nWin);
  const slots = (settings.posts_per_day ?? 5) * (settings.cycle_days ?? 3);
  const breedSlots = Math.round(slots * 0.6);

  const kinds = ['format', 'angle', 'tone', 'length_band'];
  const plan = [];
  for (let i = 0; i < breedSlots; i++) {
    const parent = winners[i % winners.length];
    const mutate = kinds[Math.floor(Math.random() * kinds.length)];
    plan.push({
      mode: 'breed',
      parent_post_id: parent.post.id,
      keep: kinds.filter(k => k !== mutate),
      mutate,
    });
  }
  while (plan.length < slots) plan.push({ mode: 'explore' });
  // shuffle so breeding isn't all front-loaded
  for (let i = plan.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [plan[i], plan[j]] = [plan[j], plan[i]];
  }
  return plan;
}

// ───────────────────────────── n8n entry point
// Set MODE via the node: 'select' | 'update' | 'plan'
const MODE = $json.mode ?? 'select';
if (MODE === 'select') {
  const product = pickProduct($json);
  const arm = pickArm({ ...$json, productUid: product.uid, plan: $json.plan });
  return [{ json: { product, ...arm } }];
}
if (MODE === 'update') return [{ json: { arms: updateArms($json) } }];
return [{ json: { plan: planNextCycle($json) } }];
