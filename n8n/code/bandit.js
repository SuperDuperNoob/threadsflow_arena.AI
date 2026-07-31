/**
 * n8n Code node — arm selection (wf2) and arm update (wf4).
 * Pure JS, no deps. Paste the relevant half into a Code node.
 *
 * Input for SELECT mode:
 *   $json.levers      : [{kind, code, brief, enabled}]
 *   $json.arm_stats      : [{scope, lever_kind, lever_code, alpha, beta, cooldown_until}]
 *   $json.context_weights: [{context_bucket, lever_kind, lever_code, alpha, beta, ...}]
 *   $json.products       : [{id, uid, name, ...}]
 *   $json.settings       : bandit settings object
 *   $json.scheduled_at   : optional slot timestamp; mapped to Work/Lunch/Evening/Late bucket
 *   $json.plan           : optional {mode:'breed', parent_post_id, keep:[], mutate:''}
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


// ───────────────────────────── context helpers (2026 Threads)

const CONTEXT_BUCKETS = [
  { code: 'Late_Night_Impulse', start: 22, end: 6 },  // 22:00-05:59 (wraps midnight)
  { code: 'Work_Focus',         start: 6, end: 12 },  // 06:00-11:59
  { code: 'Lunch_Scroll',       start: 12, end: 15 }, // 12:00-14:59
  { code: 'Evening_Relax',      start: 15, end: 22 }, // 15:00-21:59
];

const DEFAULT_CONTEXT_TONE_PRIORS = {
  Work_Focus: {
    // Office/commute mode: compressed attention, lower tolerance for loud selling.
    minimal: { alpha: 2.6, beta: 1.4 },
    deadpan: { alpha: 2.4, beta: 1.5 },
    gaul: { alpha: 1.2, beta: 1.8 },
    chaotic: { alpha: 1.0, beta: 2.0 },
  },
  Lunch_Scroll: {
    gaul: { alpha: 2.0, beta: 1.5 },
    minimal: { alpha: 1.8, beta: 1.6 },
    deadpan: { alpha: 1.6, beta: 1.7 },
  },
  Evening_Relax: {
    // After work, Threads rewards personality and conversational mess more often.
    chaotic: { alpha: 2.7, beta: 1.3 },
    gaul: { alpha: 2.5, beta: 1.4 },
    enthusiast: { alpha: 1.8, beta: 1.6 },
    minimal: { alpha: 1.2, beta: 1.9 },
    deadpan: { alpha: 1.3, beta: 1.8 },
  },
  Late_Night_Impulse: {
    chaotic: { alpha: 2.2, beta: 1.5 },
    gaul: { alpha: 2.0, beta: 1.5 },
    deadpan: { alpha: 1.7, beta: 1.7 },
  },
};

function hourInTimezone(date, timezone) {
  const d = date ? new Date(date) : new Date();
  if (!Number.isFinite(d.getTime())) return new Date().getHours();
  if (!timezone) return d.getHours();
  try {
    const parts = new Intl.DateTimeFormat('en-US', { hour: '2-digit', hour12: false, timeZone: timezone }).formatToParts(d);
    return Number(parts.find(p => p.type === 'hour')?.value ?? d.getHours()) % 24;
  } catch {
    return d.getHours();
  }
}

function contextBucketForHour(hour) {
  const h = ((Number(hour) % 24) + 24) % 24;
  return CONTEXT_BUCKETS.find(b => (
    b.start < b.end ? (h >= b.start && h < b.end) : (h >= b.start || h < b.end)
  ))?.code ?? 'Late_Night_Impulse';
}

function contextBucketForSlot({ scheduled_at, published_at, timezone } = {}) {
  return contextBucketForHour(hourInTimezone(scheduled_at ?? published_at, timezone));
}

function normalizeInput(input) {
  // n8n wf2 carries loaded config under cfg; standalone Code-node tests often pass top-level.
  const cfg = input.cfg ?? {};
  const settings = input.settings ?? {
    posting: cfg.posting ?? {},
    bandit: cfg.bandit ?? {},
    scoring: cfg.scoring ?? {},
    qa: cfg.qa ?? {},
    llm: cfg.llm ?? {},
  };
  return {
    ...cfg,
    ...input,
    levers: input.levers ?? cfg.levers ?? [],
    armStats: input.armStats ?? input.arm_stats ?? cfg.armStats ?? cfg.arm_stats ?? [],
    productStats: input.productStats ?? input.product_stats ?? cfg.productStats ?? cfg.product_stats ?? [],
    contextWeights: input.contextWeights ?? input.context_weights ?? cfg.contextWeights ?? cfg.context_weights ?? [],
    prevStats: input.prevStats ?? input.prev_arm_stats ?? input.armStats ?? input.arm_stats ?? cfg.prevStats ?? cfg.prev_arm_stats ?? [],
    prevContextWeights: input.prevContextWeights ?? input.prev_context_weights ?? input.contextWeights ?? input.context_weights ?? cfg.prevContextWeights ?? cfg.prev_context_weights ?? [],
    products: input.products ?? cfg.products ?? [],
    settings,
    plan: input.plan ?? cfg.plan ?? null,
    scheduled_at: input.scheduled_at ?? input.slot?.scheduled_at ?? null,
    timezone: input.timezone ?? input.slot?.timezone ?? settings.posting?.timezone ?? cfg.posting?.timezone,
  };
}

function contextStatKey(bucket, kind, code) {
  return `${bucket}|${kind}|${code}`;
}

function buildContextMap(contextWeights = []) {
  return new Map((contextWeights ?? []).map(w => [
    contextStatKey(w.context_bucket ?? w.bucket, w.lever_kind ?? 'tone', w.lever_code), w,
  ]));
}

function getContextPrior(contextMap, bucket, kind, code) {
  const stored = contextMap.get(contextStatKey(bucket, kind, code));
  if (stored) return { alpha: Number(stored.alpha) || 1, beta: Number(stored.beta) || 1, n: Number(stored.n) || 0 };
  if (kind === 'tone') return DEFAULT_CONTEXT_TONE_PRIORS[bucket]?.[code] ?? { alpha: 1, beta: 1, n: 0 };
  return { alpha: 1, beta: 1, n: 0 };
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
function pickArm({ levers, armStats, contextWeights, productUid, settings, plan, scheduled_at, timezone, force_sell_intensity }) {
  const eps = settings.bandit?.epsilon ?? settings.epsilon ?? 0.25;
  const now = Date.now();
  const context_bucket = contextBucketForSlot({ scheduled_at, timezone: timezone ?? settings.posting?.timezone });

  const statKey = (scope, kind, code) => `${scope}|${kind}|${code}`;
  const stats = new Map((armStats ?? []).map(s => [statKey(s.scope, s.lever_kind, s.lever_code), s]));
  const contextMap = buildContextMap(contextWeights ?? []);

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
      const images = Number(plan?.imageCount ?? 0) || 0;
      const videos = Number(plan?.videoCount ?? 0) || 0;
      let allowed;
      if (images === 0 && videos === 0) {
        allowed = ['TEXT'];
      } else if (images > 0 && videos === 0) {
        allowed = ['TEXT', 'IMAGE', 'CAROUSEL'];
      } else if (videos === 1 && images === 0) {
        allowed = ['TEXT', 'VIDEO'];
      } else { // videos >= 1 && images >= 1
        allowed = ['TEXT', 'IMAGE', 'VIDEO', 'CAROUSEL', 'MIXED_CAROUSEL'];
      }
      options = options.filter(o => allowed.includes(o.code));
      // Products WITH media should still mostly use them — they were uploaded for a reason.
      // Cap pure-text at ~30% for media products so the bandit explores without overriding intent.
      if ((images > 0 || videos > 0) && options.length > 1 && Math.random() > 0.30) {
        options = options.filter(o => o.code !== 'TEXT');
      }
    }

    if (!options.length) throw new Error(`bandit select: no enabled options for ${kind}`);

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
        const ca = getContextPrior(contextMap, context_bucket, kind, a.code);
        const cb = getContextPrior(contextMap, context_bucket, kind, b.code);
        const biasA = kind === 'tone' ? (Number(ca.alpha) / (Number(ca.alpha) + Number(ca.beta))) : 0.5;
        const biasB = kind === 'tone' ? (Number(cb.alpha) / (Number(cb.alpha) + Number(cb.beta))) : 0.5;
        return (na - biasA + Math.random() * 3) - (nb - biasB + Math.random() * 3);
      });
      chosen[kind] = options[0].code;
    } else {
      // EXPLOIT: Thompson sample. Product-scoped evidence still matters most, but tone
      // also gets a time-of-day context prior so the account does not speak the same way
      // during office focus and evening doomscroll windows.
      let best = null, bestDraw = -1;
      for (const o of options) {
        const g = stats.get(statKey('global', kind, o.code)) ?? { alpha: 1, beta: 1 };
        const p = stats.get(statKey(`product:${productUid}`, kind, o.code)) ?? { alpha: 1, beta: 1 };
        const c = getContextPrior(contextMap, context_bucket, kind, o.code);
        const hasContext = kind === 'tone';
        const a = hasContext
          ? 0.30 * Number(g.alpha) + 0.45 * Number(p.alpha) + 0.25 * Number(c.alpha)
          : 0.40 * Number(g.alpha) + 0.60 * Number(p.alpha);
        const b = hasContext
          ? 0.30 * Number(g.beta) + 0.45 * Number(p.beta) + 0.25 * Number(c.beta)
          : 0.40 * Number(g.beta) + 0.60 * Number(p.beta);
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
  // 5. Slot planner can force a no-link post for account health. Never let the bandit override it.
  if (force_sell_intensity !== undefined && force_sell_intensity !== null && force_sell_intensity !== '') {
    chosen.sell_intensity = String(force_sell_intensity);
  }

  chosen.context_bucket = context_bucket;
  chosen.combo_key = [chosen.format, chosen.angle, chosen.tone,
                      chosen.sell_intensity, chosen.length_band, chosen.media_type].join('|');
  return chosen;
}

/** Product choice: Thompson over product-level reward, with forced rotation for new products. */
function pickProduct({ products, productStats, settings }) {
  products = products ?? [];
  productStats = productStats ?? [];
  if (!products.length) throw new Error('bandit select: no active products supplied');
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
  settings = settings.bandit ?? settings;
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


/** Contextual tone stats: one row per time bucket × tone. */
function updateContextWeights({ scores, prevContextWeights, settings }) {
  const banditSettings = settings.bandit ?? settings;
  const postingSettings = settings.posting ?? {};
  const decay = banditSettings.decay ?? 0.9;
  const out = new Map();

  for (const s of (prevContextWeights ?? [])) {
    const bucket = s.context_bucket ?? s.bucket;
    const kind = s.lever_kind ?? 'tone';
    const code = s.lever_code;
    if (!bucket || !code) continue;
    out.set(contextStatKey(bucket, kind, code), {
      context_bucket: bucket,
      lever_kind: kind,
      lever_code: code,
      n: Number(s.n) * decay,
      reward_sum: Number(s.reward_sum) * decay,
      alpha: 1 + (Number(s.alpha) - 1) * decay,
      beta: 1 + (Number(s.beta) - 1) * decay,
      cooldown_until: s.cooldown_until ?? null,
    });
  }

  const vals = (scores ?? []).map(s => s.final_score);
  const min = Math.min(...vals), max = Math.max(...vals);
  const norm = v => (max === min ? 0.5 : (v - min) / (max - min));

  for (const s of (scores ?? [])) {
    const code = String(s.post?.tone ?? '');
    if (!code) continue;
    const bucket = s.post?.context_bucket ?? contextBucketForSlot({
      published_at: s.post?.published_at,
      scheduled_at: s.post?.scheduled_at,
      timezone: s.post?.timezone ?? postingSettings.timezone,
    });
    const k = contextStatKey(bucket, 'tone', code);
    const r = norm(s.final_score);
    const cur = out.get(k) ?? { context_bucket: bucket, lever_kind: 'tone', lever_code: code,
                                n: 0, reward_sum: 0, alpha: 1, beta: 1, cooldown_until: null };
    cur.n += 1;
    cur.reward_sum += r;
    cur.alpha += r;
    cur.beta += (1 - r);
    out.set(k, cur);
  }

  return [...out.values()];
}

/** Choose which winning posts to breed from next cycle. */
function planNextCycle({ scores, settings }) {
  settings = settings.bandit ? { ...settings.posting, ...settings.bandit } : settings;
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
// Set MODE via the node: 'select' | 'update' | 'plan'. If omitted, infer from payload shape.
const input = normalizeInput($json);
const MODE = $json.mode ?? (input.scores ? 'update' : 'select');
if (MODE === 'select') {
  const product = pickProduct(input);
  const imageCount = Number(product.image_count ?? product.images ?? 0) || 0;
  const plan = { ...(input.plan ?? {}), imageCount };
  const arm = pickArm({ ...input, productUid: product.uid, plan });
  return [{ json: { ...$json, product, plan, ...arm } }];
}
if (MODE === 'update') {
  return [{ json: {
    ...$json,
    arms: updateArms(input),
    context_weights: updateContextWeights(input),
    plan: planNextCycle(input),
  } }];
}
return [{ json: { ...$json, plan: planNextCycle(input) } }];
