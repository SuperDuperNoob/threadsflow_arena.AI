/**
 * n8n Code node — wf6 step 1: pick one persona topic via Thompson sampling.
 *
 * Mirrors bandit.js's SELECT logic, but over persona_topics rather than products/arms.
 *
 * Input $json (set by the preceding Postgres "load persona_topics" node):
 *   topics    : [{id, uid, topic, angle_hint, niche_tags, alpha, beta, n, cooldown_until, context, pinned}]
 *   last_n_ids: array of topic ids used in the last 7 days (avoid repetition)
 *   settings  : { bandit: { epsilon, cooldown_days, ... } }
 *   scheduled_at, timezone
 *
 * Output:
 *   Adds `{ topic: <chosen row>, purpose: 'persona' }` to the current item.
 */

// Gamma(k,1) via Marsaglia-Tsang (copy of bandit.js helper — kept standalone so this
// node can be pasted into n8n without requiring require()/import).
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
  const x = gammaSample(Math.max(a, 0.05)), y = gammaSample(Math.max(b, 0.05));
  return x / (x + y);
}

function pickTopic({ topics, lastNIds = [], settings = {} }) {
  topics = Array.isArray(topics) ? topics : [];
  if (!topics.length) throw new Error('persona_topic_pick: no topics supplied');
  const now = Date.now();

  // Filter out topics in cooldown and topics used very recently (within last 7 days),
  // unless pinning forces one through.
  const recentlyUsed = new Set(lastNIds ?? []);
  const live = topics.filter(t => {
    if (t.pinned) return true;
    if (t.cooldown_until && new Date(t.cooldown_until).getTime() > now) return false;
    if (recentlyUsed.has(t.id)) return false;
    return true;
  });

  // Prefer the filtered pool whenever it has anything — never serve a cooled-down topic
  // unless literally nothing else exists.
  const pool = live.length >= 1 ? live : topics;

  const eps = settings?.bandit?.epsilon ?? 0.2;

  // Pinned topics get priority 70% of the time when present (operator override).
  const pinned = pool.filter(t => t.pinned);
  if (pinned.length && Math.random() < 0.7) {
    return pinned[Math.floor(Math.random() * pinned.length)];
  }

  if (Math.random() < eps) {
    // EXPLORE: uniform random, biased toward least-sampled (alpha close to 1 = not yet sampled).
    const shuffled = [...pool].sort((a, b) =>
      (Number(a.alpha ?? 1) + Math.random() * 2) - (Number(b.alpha ?? 1) + Math.random() * 2));
    return shuffled[0];
  }

  // EXPLOIT: Thompson-sample Beta(alpha,beta).
  let best = null, bestDraw = -1;
  for (const t of pool) {
    const a = Number(t.alpha ?? 1);
    const b = Number(t.beta ?? 1);
    // Cold-start boost for fresh topics so they get sampled at least once before the bandit
    // trusts the 0/0 prior — an (alpha=1,beta=1) draw can still land anywhere in [0,1], but
    // topics with n===0 get a tiny extra exploration push.
    const draw = Number(t.n ?? 0) === 0 ? Math.max(betaSample(a, b), 0.3 + Math.random() * 0.4)
                                        : betaSample(a, b);
    if (draw > bestDraw) { bestDraw = draw; best = t; }
  }
  return best ?? pool[0];
}

// n8n entry point. n8n's Code node provides $json for the current item.
if (typeof $ !== 'undefined' && typeof $json !== 'undefined') {
  const picked = pickTopic($json);
  return [{ json: { ...$json, topic: picked, purpose: 'persona' } }];
}

if (typeof module !== 'undefined') {
  module.exports = { pickTopic };
}
