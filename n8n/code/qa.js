/**
 * n8n Code node — wf2 QA gate. Runs after the editor LLM pass, before INSERT.
 * Returns {pass, reasons[], cleaned} — on fail, wf2 loops back to the writer.
 *
 * This node is the entire defence against "AI template smell". Be aggressive here;
 * a regenerate costs 0.0002 USD, a templated post costs you reach for a day.
 *
 * Input $json:
 *   text            : the candidate post body
 *   embedding       : number[] of the candidate
 *   recent          : [{body, embedding}]  last 30 posts
 *   banned          : [{pattern, scope}]
 *   length_band     : 'micro'|'mid'|'long'
 *   tone            : lever code
 *   sell_intensity  : '0'|'1'|'2'
 *   product_details : string[]  the 5 concrete facts from enrichment
 *   settings        : qa settings
 */

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// Jaccard on word 3-grams — catches "same skeleton, different nouns", which embeddings miss.
function shingleOverlap(a, b, n = 3) {
  const grams = t => {
    const w = t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
    const s = new Set();
    for (let i = 0; i + n <= w.length; i++) s.add(w.slice(i, i + n).join(' '));
    return s;
  };
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

function qa(input) {
  const cfg = input.settings;
  const reasons = [];
  let text = (input.text || '').trim();

  // strip anything the model wrapped around the copy
  text = text.replace(/^```[\w]*\n?|```$/g, '').trim();
  text = text.replace(/^["'“](.*)["'”]$/s, '$1').trim();
  text = text.replace(/^(Berikut|Here'?s|Copy:|Post:)\s*:?\s*/i, '').trim();

  // 1. hard length
  if (text.length > 500) reasons.push('over Threads 500 char limit');
  const bands = { micro: [1, 120], mid: [110, 270], long: [250, 480] };
  const [lo, hi] = bands[input.length_band] ?? [1, 480];
  if (text.length < lo || text.length > hi) {
    reasons.push(`length ${text.length} outside band ${input.length_band} (${lo}-${hi})`);
  }

  // 2. banned phrases
  for (const b of input.banned) {
    if (b.scope !== 'all' && b.scope !== 'opener' && b.scope !== input.tone) continue;
    const target = b.scope === 'opener' ? text.slice(0, 60) : text;
    let re;
    try { re = new RegExp(b.pattern, 'iu'); } catch { continue; }
    if (re.test(target)) reasons.push(`banned phrase: ${b.pattern}`);
  }

  // 3. emoji policy
  const emojis = text.match(EMOJI_RE) ?? [];
  const emojiCap = ['deadpan', 'minimal'].includes(input.tone) ? 0 : (cfg.max_emoji ?? 2);
  if (emojis.length > emojiCap) reasons.push(`${emojis.length} emoji > cap ${emojiCap} for tone ${input.tone}`);

  // 4. hashtags
  const tags = text.match(/#\w+/g) ?? [];
  if (tags.length > 1) reasons.push('more than 1 hashtag');
  if (tags.length === 1 && Math.random() > (cfg.hashtag_probability ?? 0.4)) {
    text = text.replace(/\s*#\w+/g, '').trim();   // silently drop instead of failing
  }

  // 5. must contain at least one concrete product fact (number, unit, or a detail token)
  const hasNumber = /\d/.test(text);
  const hasDetail = (input.product_details ?? []).some(d => {
    const tok = String(d).toLowerCase().split(/\s+/).filter(w => w.length > 4);
    return tok.some(w => text.toLowerCase().includes(w));
  });
  if (!hasNumber && !hasDetail && input.sell_intensity !== '0') {
    reasons.push('no concrete product detail — will read generic');
  }

  // 6. must not open with the product name
  if (input.product_name) {
    const first = text.slice(0, input.product_name.length + 4).toLowerCase();
    if (first.startsWith(input.product_name.toLowerCase().slice(0, 12))) {
      reasons.push('opens with product name');
    }
  }

  // 7. structural AI tells
  if ((text.match(/—/g) ?? []).length >= 2) reasons.push('em-dash chain');
  if (/^\s*[-*•]\s/m.test(text) && input.length_band !== 'long') reasons.push('bullet list');
  if (/\?\s*$/.test(text) && /^\s*\w+.*\?/.test(text.split('\n')[0])) {
    // opens with a question AND closes with a question = classic engagement-bait shape
    reasons.push('question sandwich');
  }
  if (/(\b\w+\b)(\s+\1\b){2,}/i.test(text)) reasons.push('word repetition');

  // 8. sell intensity compliance
  const salesWords = /(beli|checkout|order|co\b|klik|link di|swipe|keranjang)/i;
  if (input.sell_intensity === '0' && salesWords.test(text)) reasons.push('sell words in intensity-0 post');

  // 9. anti-repetition vs last 30 posts
  let maxSim = 0, maxShingle = 0;
  for (const r of input.recent ?? []) {
    maxSim = Math.max(maxSim, cosine(input.embedding, r.embedding));
    maxShingle = Math.max(maxShingle, shingleOverlap(text, r.body));
  }
  if (maxSim > (cfg.max_similarity ?? 0.86)) reasons.push(`too similar to a recent post (cos ${maxSim.toFixed(3)})`);
  if (maxShingle > 0.18) reasons.push(`reuses phrasing skeleton (3-gram overlap ${maxShingle.toFixed(3)})`);

  // 10. opener uniqueness — first 5 words must not have been used in the last 30 posts
  const opener = t => t.toLowerCase().split(/\s+/).slice(0, 5).join(' ');
  if ((input.recent ?? []).some(r => opener(r.body) === opener(text))) reasons.push('duplicate opener');

  return {
    pass: reasons.length === 0,
    reasons,
    cleaned: text,
    stats: {
      chars: text.length,
      emoji: emojis.length,
      hashtag: (text.match(/#\w+/g) ?? []).length > 0,
      max_similarity: maxSim,
      max_shingle: maxShingle,
    },
  };
}

return [{ json: qa($json) }];
