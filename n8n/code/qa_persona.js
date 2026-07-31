/**
 * n8n Code node — wf6 QA gate for persona posts.
 *
 * Reuses qa.js's structural checks (length, emoji, caps, repetition, similarity, opener uniqueness)
 * and tightens the rules for pure-engagement posts:
 *   - NO affiliate/promo words (Shopee, Lazada, link, klik, beli, etc)
 *   - NO broadcasters' openers ("Korang pernah tak...", "Siapa kat sini...")
 *   - NO product names or prices (there is no product on a persona post)
 *   - MUST contain at least one specific/concrete anchor (time, place, RM amount, body sensation,
 *     kedai, mamak, dapur, etc) — generic "relatable" platitudes are rejected
 *   - Questions are allowed, but question-sandwich (open with ? AND close with ?) is still banned
 *   - Same 500-char hard cap, same Indonesian word bans, same shouting cap
 *
 * Input $json:
 *   text            : candidate body from the editor/rewrite LLM pass
 *   embedding       : number[] embedding of the candidate
 *   recent          : [{body, embedding}] last 30 posts (purpose-agnostic)
 *   banned          : [{pattern, scope}] from banned_phrases (persona_opener / persona_all are included)
 *   length_band     : 'micro'|'mid'|'long'
 *   tone            : lever code
 *   settings        : qa settings
 */

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;

// Promo/sell words persona posts MUST never contain.
const PERSONA_SELL_WORDS = /\b(shopee|lazada|tiktok.?shop|affiliate|voucher|diskaun|discount|promo|checkout|order|co\b|beli sekarang|klik link|link di (bawah|bio|komen)|DM saya|wa\.me|t\.me|bio saya|link ada)\b/i;

// Words/phrases that a "real person" doesn't open with. Caught by banned_phrases with scope
// 'persona_opener', but duplicated here as a defense in case the DB rows are missing.
const PERSONA_BAD_OPENERS = [
  /^\s*Korang (pernah|rasa|tahu|perasan) tak\b/i,
  /^\s*Siapa (kat sini|di sini|yang)\b/i,
  /^\s*(Jom|Jangan lepaskan|Save dulu|Share|Hai semua|Assalammualaikum semua|Hi korang)\b/i,
  /^\s*(Thread|Post) kali ini\b/i,
  /^\s*(Saya nak share|Nak share|Harini saya nak share)\b/i,
];

// Concrete anchors — at least one of these categories must be present. This is the
// specificity enforcement that stops the output from reading as generic "relatable content".
const ANCHOR_PATTERNS = [
  /\bRM\s?\d+/,                                    // money (RM4, RM 3.50)
  /\b\d+\s?(minit|jam|hari|minggu|bulan|tahun)\b/i,// time
  /\b(pagi|tengahari|petang|malam|subuh|maghrib)\b/i,
  /\b(mamak|kopitiam|warung|kedai|dapur|bilik|pejabat|ofis|lif|escalator|lrt|mrt|komuter|highway|traffic light)\b/i,
  /\b(hujan|panas|petir|ribut|jerebu)\b/i,
  /\b(nasi|kicap|sambal|teh tarik|teh o|kopi o|milo|roti canai|roti|sup|maggi|kari|sayur)\b/i,
  /\b(wangi|bau|panas|sejuk|lembap|licin|kasar|melekit|berdecit|berdentum)\b/i,  // sensory
  /\b(telefon|phone|laptop|kipas|aircond|rice cooker|peti ais|sinki|cerek|plug|cas)\b/i,  // objects
  /\b(mak|abah|abang|kakak|adik|pakcik|makcik|kawan|boss|rider|cashier)\b/i,      // people
  /\b(semalam|kelmarin|tadi|tadi pagi|petang tadi|pagi tadi|hari tu|masa tu)\b/i, // time deictics
  /\d/,                                             // any digit (minutes, degrees, ringgit, quantity)
];

// Indonesian false friends — same ban list as qa.js, repeated so this module is standalone.
const INDONESIAN_BAN = /\b(banget|nggak|gak|aja|udah|bikin|gimana|kalian|doang|cowok|cewek|gue|deh|dong|sih)\b/i;
const FALSE_FRIENDS = [
  [/\bbisa\b/i, 'bisa = venom in BM; use boleh'],
  [/\bbutuh\b/i, 'butuh = vulgar in BM; use perlu'],
  [/\bpusing\b(?!\s+(kiri|kanan|sana))/i, 'pusing = turn in BM; use pening/sakit kepala'],
];

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

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

function qaPersona(input) {
  const cfg = input.settings?.qa ?? input.settings ?? {};
  const reasons = [];
  let text = String(input.text ?? '').trim();

  // Strip wrappers the model sometimes adds.
  text = text.replace(/^```[\w]*\n?|```$/g, '').trim();
  text = text.replace(/^["'"](.*)["'"]$/s, '$1').trim();
  text = text.replace(/^(Berikut|Here'?s|Copy:|Post:)\s*:?\s*/i, '').trim();

  // 1. Hard length — 500 Threads cap, with band constraints.
  if (text.length > 500) reasons.push('over Threads 500 char limit');
  const bands = { micro: [1, 120], mid: [90, 270], long: [220, 480] };
  const [lo, hi] = bands[input.length_band] ?? [1, 480];
  if (text.length < lo || text.length > hi) {
    reasons.push(`length ${text.length} outside persona band ${input.length_band} (${lo}-${hi})`);
  }

  // 2. Global banned phrases (scope 'all') + persona-specific (scope 'persona_opener'/'persona_all').
  for (const b of input.banned ?? []) {
    if (!['all', 'persona_opener', 'persona_all'].includes(b.scope)
        && b.scope !== input.tone) continue;
    const target = b.scope === 'persona_opener' || b.scope === 'opener' ? text.slice(0, 70) : text;
    let re;
    try { re = new RegExp(b.pattern, 'iu'); } catch { continue; }
    if (re.test(target)) reasons.push(`banned phrase: ${b.pattern}`);
  }

  // 3. Persona-specific promo/sell word ban (defense in depth even if DB rows are missing).
  if (PERSONA_SELL_WORDS.test(text)) reasons.push('persona post contains promo/sell language');

  // 4. Persona-specific broadcast openers.
  for (const rx of PERSONA_BAD_OPENERS) {
    if (rx.test(text)) { reasons.push('persona post opens with a broadcast/influencer line'); break; }
  }

  // 5. Indonesian + false friends.
  if (INDONESIAN_BAN.test(text)) reasons.push('contains Indonesian word(s)');
  for (const [rx, why] of FALSE_FRIENDS) {
    if (rx.test(text)) { reasons.push(`false friend: ${why}`); break; }
  }

  // 6. Emoji cap (stricter for deadpan/minimal on persona too).
  const emojis = text.match(EMOJI_RE) ?? [];
  const emojiCap = ['deadpan', 'minimal'].includes(input.tone) ? 0 : (cfg.max_emoji ?? 2);
  if (emojis.length > emojiCap) reasons.push(`${emojis.length} emoji > cap ${emojiCap} for tone ${input.tone}`);

  // 7. Hashtag cap (1 max, <40% chance to keep).
  const tags = text.match(/#\w+/g) ?? [];
  if (tags.length > 1) reasons.push('more than 1 hashtag');
  if (tags.length === 1 && Math.random() > (cfg.hashtag_probability ?? 0.3)) {
    text = text.replace(/\s*#\w+/g, '').trim();
  }

  // 8. SHOUTING cap (same threshold as product QA).
  const shout = (text.match(/\b[A-Z]{4,}\b/g) ?? [])
    .filter(w => !/^(RM|OK|USB|LED|PDF|XL|XXL|COD|DIY|FYI|PM|AM|PM|KL|JB|PJ|IOI)$/.test(w));
  if (shout.length >= 3) reasons.push(`${shout.length} ALL-CAPS words — reads as an ad`);
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length >= 8 && shout.length / words.length > 0.25) {
    reasons.push('more than a quarter of the post is shouting');
  }

  // 9. Structural AI tells.
  if ((text.match(/—/g) ?? []).length >= 2) reasons.push('em-dash chain');
  if (/^\s*[-*•]\s/m.test(text)) reasons.push('bullet list in a short persona post');
  if (/\?\s*$/.test(text) && /^\s*\w+.*\?/.test(text.split('\n')[0])) {
    reasons.push('question sandwich');
  }
  if (/(\b\w+\b)(\s+\1\b){2,}/i.test(text)) reasons.push('word repetition');

  // 10. Concrete anchor — at least one ANCHOR_PATTERN must match.
  const hasAnchor = ANCHOR_PATTERNS.some(rx => rx.test(text));
  if (!hasAnchor) reasons.push('persona post has no concrete anchor (time/place/sensation/object/person/number) — too generic');

  // 11. Must NOT reference an image that does not exist (persona posts are text-only).
  if (/\b(gambar|foto|fotonya|gambarnya|di atas|liat nih|lihat gambar|swipe|geser)\b/i.test(text)) {
    reasons.push('text-only persona post references an image');
  }

  // 12. Anti-repetition vs last 30 posts (cosine sim + 3-gram shingle overlap).
  let maxSim = 0, maxShingle = 0;
  for (const r of input.recent ?? []) {
    maxSim = Math.max(maxSim, cosine(input.embedding, r.embedding));
    maxShingle = Math.max(maxShingle, shingleOverlap(text, r.body));
  }
  if (maxSim > (cfg.max_similarity ?? 0.86)) reasons.push(`too similar to a recent post (cos ${maxSim.toFixed(3)})`);
  if (maxShingle > 0.18) reasons.push(`reuses phrasing skeleton (3-gram overlap ${maxShingle.toFixed(3)})`);

  // 13. Opener uniqueness vs last 30 posts (same 5-word rule).
  const opener = t => t.toLowerCase().split(/\s+/).slice(0, 5).join(' ');
  if ((input.recent ?? []).some(r => opener(r.body) === opener(text))) reasons.push('duplicate opener');

  return {
    pass: reasons.length === 0,
    reasons,
    cleaned: text,
    stats: {
      media_type: 'TEXT',
      chars: text.length,
      emoji: emojis.length,
      hashtag: (text.match(/#\w+/g) ?? []).length > 0,
      max_similarity: maxSim,
      max_shingle: maxShingle,
      purpose: 'persona',
    },
  };
}

// n8n entry point — called after the embedding HTTP response, mirroring qa.js's n8nInput().
function n8nInput() {
  if (typeof $ !== 'function') return $json;
  try {
    // Pull base from 'Build prompts' — that's the last Code node before the LLM chain, so it
    // carries slot fields (format, tone, length_band, scheduled_at), cfg, topic, post_uid, etc.
    const base = $('Build prompts').item.json;
    const edited = $('Persona LLM: editor pass').item.json.choices?.[0]?.message?.content ?? '';
    const embedding = $json.data?.[0]?.embedding ?? $json.embedding;
    return {
      ...base,
      text: edited,
      embedding,
      recent: base.cfg?.recent ?? base.recent ?? [],
      banned: base.cfg?.banned ?? base.banned ?? [],
      settings: base.cfg?.qa ?? base.settings?.qa ?? base.qa ?? {},
      tone: base.tone,
      length_band: base.length_band,
    };
  } catch {
    return $json;
  }
}

const input = (typeof $ !== 'undefined' && typeof $json !== 'undefined') ? n8nInput() : null;
if (input) {
  const out = qaPersona(input);
  return [{ json: { ...input, ...out } }];
}

if (typeof module !== 'undefined') {
  module.exports = { qaPersona };
}
