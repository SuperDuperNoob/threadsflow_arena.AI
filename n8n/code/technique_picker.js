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
    // A technique that leans on the photo ("make the object the grammatical subject") must
    // never fire on a text-only post — it would produce copy describing an image nobody sees.
    const okM = !t.compatible_media?.length || t.compatible_media.includes(arm.media_type);
    return okF && okT && okI && okM;
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

function shortId(n = 10) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function lever(input, kind) {
  const code = input[kind];
  return (input.cfg?.levers ?? input.levers ?? []).find(l => l.kind === kind && l.code === code) ??
    { kind, code, label: code, brief: '' };
}

function lines(xs, fallback = '- tiada') {
  return (xs ?? []).filter(Boolean).length ? xs.filter(Boolean).map(x => `- ${x}`).join('\n') : fallback;
}

function targetRange(lengthBand) {
  return ({ micro: [1, 120], mid: [110, 270], long: [250, 480] })[lengthBand] ?? [1, 480];
}

function buildGenerationContext(input, devicesOut) {
  const product = input.product ?? {};
  const enrichment = product.enrichment ?? {};
  const images = input.images ?? [];
  const hasImage = input.media_type !== 'TEXT' && images.length > 0;
  const imageIds = hasImage ? images.map(i => i.id).filter(Boolean) : [];
  const envRedirect = (typeof process !== 'undefined' ? process.env?.PUBLIC_REDIRECT_BASE : '') || '';
  const redirectBase = String(input.cfg?.posting?.redirect_base_url ?? input.settings?.posting?.redirect_base_url ?? envRedirect ?? 'https://r.yourdomain.com').replace(/\/+$/, '');
  const postUid = `p${shortId(9)}`;
  const trackedUrl = `${redirectBase}/p/${postUid}`;
  const ctaPool = [
    'link dia kat sini {{link}}', 'yang tanya tadi, ni dia {{link}}',
    'untuk yang nak tengok harga {{link}}', 'detail penuh kat sini {{link}}',
    'saya beli kat sini {{link}}', 'ni {{link}}'
  ];
  const ctaTemplate = ctaPool[Math.floor(Math.random() * ctaPool.length)];
  const ctaText = String(input.sell_intensity) === '0' ? null : ctaTemplate.replace('{{link}}', trackedUrl);

  const banned = (input.cfg?.banned ?? input.banned ?? []).map(b => b.pattern).slice(0, 40).join(', ');
  const recent = (input.cfg?.recent ?? input.recent ?? []).slice(0, 20);
  const recentLines = recent.map(r => String(r.body ?? '').split('\n')[0].slice(0, 160));
  const openers = recentLines.map(t => t.split(/\s+/).slice(0, 5).join(' ')).filter(Boolean).join(' | ');
  const lev = Object.fromEntries(['format','angle','tone','sell_intensity','length_band','media_type'].map(k => [k, lever(input, k)]));
  const [targetMin, targetMax] = targetRange(input.length_band);
  const imageText = hasImage
    ? `### The image this post will carry\n${images.map(i => i.vision_desc).filter(Boolean).join('\n') || 'Product image attached; keep the copy consistent with it.'}\nDo not describe what is already visible. Say what the photo cannot show.`
    : `### No image — this is a text-only post\nThere is no photo. The first line must do the work a picture would do. Use at least one physical product detail.`;

  const writerSystem = `You are a specific person posting on Threads from your phone in Malaysia. Write casual Malaysian Malay, not Indonesian and not formal Dewan Bahasa. Use tak, nak, dah, je, kot, lah, kan, boleh, jom, tengok, letak, guna. Rojak English is normal.\n\nHard rules:\n1. Never use Indonesian slang: banget, nggak, gak, aja, udah, bikin, gimana, kalian, doang, cowok, cewek, gue, deh, dong, sih. Never use bisa/butuh/pusing wrongly. Currency is RM.\n2. Never open with a generic rhetorical question. Never start with the product name.\n3. Never use these banned patterns/phrases: ${banned || '(none)'}\n4. Include at least one concrete, checkable product detail. No vague adjectives.\n5. Output ONLY the post text. No quotes, no preamble, no options.`;

  const writerUser = `### Product facts\nName: ${product.name ?? enrichment.name ?? ''}\nPrice: RM ${enrichment.price_myr ?? ''}\nCommission/rating/sales: ${enrichment.shopee_commission_rate ?? ''} · ${enrichment.shopee_rating ?? ''} · ${enrichment.shopee_sales ?? ''}\nCategory: ${enrichment.category ?? ''}\nWho it is for: ${enrichment.target_persona ?? ''}\nConcrete details:\n${lines(enrichment.concrete_details)}\nReal buyer quotes you may paraphrase only if listed:\n${lines(enrichment.top_reviews, '- none supplied')}\nPhysical details:\n${lines(enrichment.sensory_details, '- none supplied')}\nProduct description: ${product.description ?? ''}\nMy notes: ${product.notes ?? ''}\n\n${imageText}\n\n### Assignment\n- Format: ${lev.format.label} — ${lev.format.brief}\n- Persuasion angle: ${lev.angle.label} — ${lev.angle.brief}\n- Tone: ${lev.tone.label} — ${lev.tone.brief}\n- Selling intensity: ${lev.sell_intensity.label} — ${lev.sell_intensity.brief}\n- Length: ${lev.length_band.label} — ${lev.length_band.brief}\n- Media: ${lev.media_type.label} — ${lev.media_type.brief}\n\n### Do not resemble these recent openings\n${lines(recentLines, '- none yet')}\n\nOpenings already used recently: ${openers || 'none yet'}\n${input.persona_fragment ?? ''}\n${devicesOut.fragment ?? ''}\n\nBefore writing, silently pick one mundane, specific moment this product touches. Write from inside that moment.\nWrite the post now.`;

  const editorSystem = `You are a skeptical Malaysian editor. Make the text stop sounding like AI or brand copy. Replace Indonesian with Malaysian Malay. Delete generic adjectives, symmetrical sentence pairs, funnel words, emoji-as-punctuation, tidy endings, and imported meme slang. Keep the same meaning and persuasion angle. Output ONLY the edited post.`;
  const editorUserPrefix = `Intended tone: ${lev.tone.label} — ${lev.tone.brief}\nIntended length: ${targetMin}-${targetMax} characters.\nRewrite it so it reads like someone typed it on their phone and hit post without re-reading. Draft:\n`;

  return {
    post_uid: postUid,
    tracked_url: trackedUrl,
    cta_text: ctaText,
    image_ids: imageIds,
    media_type: hasImage ? input.media_type : 'TEXT',
    is_carousel: hasImage && input.media_type === 'CAROUSEL' && imageIds.length > 1,
    writer_system: writerSystem,
    writer_user: writerUser,
    editor_system: editorSystem,
    editor_user_prefix: editorUserPrefix,
    product_details: [...(enrichment.concrete_details ?? []), ...(enrichment.sensory_details ?? [])],
    target_min: targetMin,
    target_max: targetMax,
  };
}

const MODE = $json.mode ?? 'select';
if (MODE === 'select') {
  const devicesOut = selectDevices($json);
  const generation = buildGenerationContext($json, devicesOut);
  return [{ json: { ...$json, ...devicesOut, ...generation } }];
}
return [{ json: { ...$json, techniques: updateTechniques($json) } }];
