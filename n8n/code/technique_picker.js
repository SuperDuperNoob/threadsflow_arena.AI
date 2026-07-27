/**
 * n8n Code node — wf2, runs after bandit.js picks the levers.
 * Selects 1-2 compatible techniques ("devices") to inject into the writer prompt,
 * and renders the prompt fragment.
 *
 * Also contains the wf4-side update function so techniques earn/lose weight exactly like levers.
 *
 * Input $json:
 *   techniques : rows from `techniques` WHERE enabled
 *   arm        : {format, angle, tone, sell_intensity, length_band}
 *   recent_technique_ids : ids used in the last 6 posts (avoid immediate repeats)
 *   mode       : 'select' | 'update'
 */

// Beta sampling (same as bandit.js — duplicated so each Code node is standalone)
function normalSample() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function gammaSample(k) {
  if (k < 1) return gammaSample(k + 1) * Math.pow(Math.random(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { x = normalSample(); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
const betaSample = (a, b) => { const x = gammaSample(a), y = gammaSample(b); return x / (x + y); };

/**
 * Why max 2 devices:
 *   0 devices → the library does nothing, you wasted an afternoon
 *   1-2       → shapes the post without defining it
 *   3+        → the LLM produces a checklist-shaped post. It reads mechanical. This is the
 *               single fastest way to reintroduce the template smell you're trying to kill.
 * Empirically 2 is the ceiling for a <500 char post. Do not raise this.
 */
const MAX_DEVICES = 2;

function selectDevices({ techniques, arm, recent_technique_ids = [] }) {
  const now = Date.now();
  const intensity = Number(arm.sell_intensity);

  const compatible = techniques.filter(t => {
    if (!t.enabled) return false;
    if (t.cooldown_until && new Date(t.cooldown_until).getTime() > now) return false;
    if (t.type === 'anti_pattern') return false;         // those live in banned_phrases, not here
    // empty array = universal
    const okF = !t.compatible_formats?.length   || t.compatible_formats.includes(arm.format);
    const okT = !t.compatible_tones?.length     || t.compatible_tones.includes(arm.tone);
    const okI = !t.compatible_intensity?.length || t.compatible_intensity.includes(intensity);
    return okF && okT && okI;
  });

  if (!compatible.length) return { devices: [], fragment: '' };

  // Don't reuse a technique from the last 6 posts unless the pool is tiny — same reason we
  // rotate images: repetition at the *device* level produces posts that rhyme with each other.
  const pool = compatible.filter(t => !recent_technique_ids.includes(t.id));
  const usable = pool.length >= 4 ? pool : compatible;

  // One device is always a hook/structure (shapes the post), the second is anything else
  // (adds texture). Two hooks fight each other for the opening line.
  const shapers = usable.filter(t => ['hook', 'structure'].includes(t.type));
  const texture = usable.filter(t => !['hook', 'structure'].includes(t.type));

  const draw = list => {
    let best = null, bestScore = -1;
    for (const t of list) {
      const a = Math.max(Number(t.alpha) || 1, 0.05);
      const b = Math.max(Number(t.beta) || 1, 0.05);
      let s = betaSample(a, b);
      // contested claims get an exploration bonus — settling an argument between two famous
      // copywriters with your own conversion data is worth spending slots on
      if (t.contested && Number(t.n) < 8) s += 0.15;
      // untested techniques get a small bonus so the library doesn't sit unused
      if (Number(t.n) < 2) s += 0.10;
      if (s > bestScore) { bestScore = s; best = t; }
    }
    return best;
  };

  const devices = [];
  if (shapers.length && Math.random() < 0.75) devices.push(draw(shapers));
  const remaining = texture.filter(t => !devices.includes(t));
  if (remaining.length && devices.length < MAX_DEVICES && Math.random() < 0.7) {
    devices.push(draw(remaining));
  }
  // 15% of posts get zero devices — a pure-bandit control group. Without this you can never
  // tell whether the Technique Library is helping at all.
  if (Math.random() < 0.15) devices.length = 0;

  const fragment = devices.length ? `
### Craft constraints for this post
Apply these invisibly. Never name them, never explain them, never let the reader detect a formula.
${devices.map(d => `- ${d.instruction}
  Like this: ${d.example_do}
  Not like this: ${d.example_dont}`).join('\n')}
` : '';

  return { devices, device_ids: devices.map(d => d.id), fragment, is_control: !devices.length };
}

/**
 * wf4 side: fold cycle scores back into technique alpha/beta.
 * Input: {scores:[{post_id, final_score, technique_ids:[]}], prev:[techniques rows], settings}
 */
function updateTechniques({ scores, prev, settings }) {
  const decay = settings.decay ?? 0.9;
  const vals = scores.map(s => s.final_score);
  const min = Math.min(...vals), max = Math.max(...vals);
  const norm = v => (max === min ? 0.5 : (v - min) / (max - min));

  const out = new Map(prev.map(t => [t.id, {
    id: t.id, code: t.code,
    n: Number(t.n) * decay,
    reward_sum: Number(t.reward_sum) * decay,
    alpha: 1 + (Number(t.alpha) - 1) * decay,
    beta: 1 + (Number(t.beta) - 1) * decay,
    cooldown_until: t.cooldown_until,
  }]));

  for (const s of scores) {
    const r = norm(s.final_score);
    for (const id of s.technique_ids ?? []) {
      const cur = out.get(id);
      if (!cur) continue;
      cur.n += 1; cur.reward_sum += r; cur.alpha += r; cur.beta += (1 - r);
    }
  }

  // Cool down techniques that have earned their verdict. Threshold is n >= 6 because a
  // technique appears in far fewer posts than a lever value — don't judge it on 2 samples.
  const arr = [...out.values()];
  const judged = arr.filter(t => t.n >= 6);
  if (judged.length >= 5) {
    judged.sort((a, b) => (a.reward_sum / a.n) - (b.reward_sum / b.n));
    const nCool = Math.max(1, Math.floor(judged.length * 0.25));
    for (let i = 0; i < nCool; i++) {
      judged[i].cooldown_until = new Date(Date.now() + 12 * 864e5).toISOString();
    }
  }
  return arr;
}

const MODE = $json.mode ?? 'select';
return MODE === 'select'
  ? [{ json: selectDevices($json) }]
  : [{ json: { techniques: updateTechniques($json) } }];
