/**
 * n8n Code node — wf2/wf6 persona calibration.
 *
 * Input:
 *   $json.cfg.persona_snippets : [{id, domain, title, register, tags, text}]
 *   $json.tone                 : selected tone code from bandit
 *   $json.product              : product object with category_hint / enrichment (wf2 only)
 *   $json.time_of_day          : morning|midday|afternoon|evening (wf6 only)
 *   $json.purpose              : 'product' | 'persona'
 *
 * Output:
 *   Adds persona_snippets + persona_fragment for the writer prompt.
 *
 * The snippets are style/rhythm references only. They must never become facts in a product post.
 */

function shuffle(xs) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Map each tone to the registers it should prefer.
 * Extended with makcik and all persona tones.
 */
function toneRegisters(tone) {
  return ({
    warm_sibling:   ['reflective', 'conversational'],
    deadpan:        ['neutral', 'informative'],
    minimal:        ['neutral', 'informative'],
    gaul:           ['conversational', 'neutral'],
    chaotic:        ['conversational'],
    makcik:         ['conversational', 'reflective'],  // makcik = long-winded, nagging, funny details
    enthusiast:     ['conversational', 'informative'],
    corporate_parody: ['formal', 'informative'],
  })[tone] ?? ['conversational', 'neutral', 'reflective'];
}

/**
 * Time-of-day domain preferences.
 * Some domains are more relevant at certain times.
 */
function timeOfDayDomains(timeOfDay) {
  return ({
    morning:   ['commute', 'mamak', 'facebook', 'twitter'],     // commute, breakfast
    midday:    ['work', 'lowyat', 'facebook', 'twitter'],       // office, lunch
    afternoon: ['mamak', 'parenting', 'facebook', 'iium'],      // household, petua
    evening:   ['iium', 'mamak', 'facebook', 'twitter'],        // food, family, reflection
  })[timeOfDay] ?? ['facebook', 'iium', 'twitter'];
}

function clean(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Score a snippet for category/domain relevance to the product (wf2) or purpose (wf6).
 */
function categoryScore(snippet, product, purpose) {
  if (!product && purpose === 'persona') {
    // Persona posts don't have products — score by snippet quality only
    return 0;
  }

  const categoryText = String(
    product?.category_hint || product?.enrichment?.category || product?.name || ''
  ).toLowerCase();

  const domain = String(snippet.domain || snippet.source_domain || '').toLowerCase();
  const tags = Array.isArray(snippet.tags) ? snippet.tags.map(t => t.toLowerCase()) : [];
  const text = String(snippet.text || '').toLowerCase();

  const techKeywords = ['tech', 'gadget', 'phone', 'laptop', 'wireless', 'usb', 'charger',
    'audio', 'sound', 'camera', 'peranti', 'skrin', 'bateri', 'moniter', 'keyboard', 'router',
    'earbuds', 'smartwatch', 'monitor', 'speaker', 'drone', 'tablet'];
  const lifestyleKeywords = ['rumah', 'dapur', 'baju', 'kasut', 'skin', 'beauty', 'mask',
    'kain', 'makanan', 'decor', 'bilik', 'budak', 'anak', 'beg', 'tuala', 'periuk', 'kuali'];
  const foodKeywords = ['makan', 'nasi', 'roti', 'teh', 'kopi', 'mamak', 'char kuetiaw',
    'satay', 'laksa', 'cendol', 'mee', 'sup', 'goreng', 'curry', 'sambal'];
  const parentingKeywords = ['anak', 'baby', 'parenting', 'ibu', 'bapa', 'sekolah', 'taska',
    'budak', 'toddler', 'menyusu', 'pampers'];

  const isTechProduct = techKeywords.some(k => categoryText.includes(k));
  const isLifestyleProduct = lifestyleKeywords.some(k => categoryText.includes(k));
  const isFoodProduct = foodKeywords.some(k => categoryText.includes(k));
  const isParentingProduct = parentingKeywords.some(k => categoryText.includes(k));

  let score = 0;

  if (isTechProduct) {
    if (domain.includes('amanz') || tags.includes('tech') || tags.includes('review')) score += 4;
    if (text.includes('peranti') || text.includes('spesifikasi') || text.includes('review')) score += 2;
  }
  if (isLifestyleProduct) {
    if (domain.includes('iium') || domain.includes('facebook') || snippet.register === 'reflective') score += 3;
    if (tags.includes('household') || tags.includes('petua')) score += 2;
  }
  if (isFoodProduct) {
    if (domain.includes('mamak') || tags.includes('food')) score += 4;
  }
  if (isParentingProduct) {
    if (domain.includes('parenting') || tags.includes('parenting')) score += 4;
    if (domain.includes('iium') || snippet.register === 'reflective') score += 2;
  }

  return score;
}

/**
 * Score a snippet for time-of-day relevance.
 */
function timeOfDayScore(snippet, timeOfDay) {
  if (!timeOfDay) return 0;

  const preferredDomains = timeOfDayDomains(timeOfDay);
  const domain = String(snippet.domain || snippet.source_domain || '').toLowerCase();
  const tags = Array.isArray(snippet.tags) ? snippet.tags.map(t => t.toLowerCase()) : [];

  // Check if snippet's domain matches preferred domains
  const domainMatch = preferredDomains.some(pd => domain.includes(pd));
  if (domainMatch) return 1;

  // Check tags for time-of-day relevance
  const text = String(snippet.text || '').toLowerCase();
  const timeKeywords = {
    morning:   ['pagi', 'sarapan', 'breakfast', 'subuh', 'bangun', 'commute', 'drive', 'LRT', 'MRT'],
    midday:    ['tengahari', 'lunch', 'kerja', 'office', 'meeting', 'boss', 'kawan office'],
    afternoon: ['petang', 'dapur', 'masak', 'kemas', 'petua', 'anak', 'sekolah'],
    evening:   ['malam', 'dinner', 'makan malam', 'hujan', 'sup', 'keluarga', 'suami', 'bini'],
  };

  const keywords = timeKeywords[timeOfDay] || [];
  const keywordMatch = keywords.some(k => text.includes(k.toLowerCase()));
  if (keywordMatch) return 1;

  return 0;
}

/**
 * Score a snippet for tone/register match.
 * Makcik tone prefers longer, more detailed snippets.
 */
function toneScore(snippet, tone) {
  const preferred = toneRegisters(tone);
  let score = preferred.includes(snippet.register) ? 3 : 0;

  // Makcik tone prefers longer snippets with lots of detail
  if (tone === 'makcik') {
    const text = snippet.text || '';
    if (text.length > 300) score += 2;
    if (/\b(makcik|jiran|kawan|borak|cerita)\b/i.test(text)) score += 2;
  }

  // Deadpan/minimal prefers shorter snippets
  if (['deadpan', 'minimal'].includes(tone)) {
    const text = snippet.text || '';
    if (text.length < 200) score += 2;
  }

  // Gaul prefers conversational with slang
  if (tone === 'gaul') {
    const text = snippet.text || '';
    if (/\b(gila|best|padu|mantap|hahaha|lol)\b/i.test(text)) score += 2;
  }

  return score;
}

function pickPersonaSnippets(input) {
  const all = input.persona_snippets ?? input.cfg?.persona_snippets ?? [];
  if (!Array.isArray(all) || !all.length) return { persona_snippets: [], persona_fragment: '' };

  const tone = input.tone || 'gaul';
  const product = input.product || input.product_data || {};
  const purpose = input.purpose || 'product';
  const timeOfDay = input.time_of_day || null;

  const ranked = all
    .map(s => {
      const cleanedText = clean(s.text);
      let score = 0;
      score += toneScore(s, tone);
      score += categoryScore(s, product, purpose);
      score += timeOfDayScore(s, timeOfDay);
      return { ...s, text: cleanedText, score };
    })
    .filter(s => s.text.length >= 80 && s.text.length <= 750)
    .sort((a, b) => b.score - a.score || Math.random() - 0.5);

  // Pick more candidates and shuffle for variety
  const candidates = ranked.slice(0, 16);
  const picked = shuffle(candidates).slice(0, 3);
  if (!picked.length) return { persona_snippets: [], persona_fragment: '' };

  const lines = picked.map((s, i) => {
    const label = [s.register, s.domain || s.source_domain].filter(Boolean).join(' · ');
    return `${i + 1}. (${label}) ${s.text.slice(0, 520)}`;
  });

  const purposeNote = purpose === 'persona'
    ? 'These are persona calibration references. Borrow rhythm, register, and sentence structure. Do not copy topic or facts.'
    : 'These are NOT facts and NOT templates. Borrow only rhythm, sentence pressure, and Malay register. Do not copy wording, claims, religious advice, or topic.';

  return {
    persona_snippets: picked,
    persona_fragment: `\n### Persona calibration — Malaysian cadence references\n${purposeNote}\n${lines.join('\n')}\n`,
  };
}

// n8n entry point
if (typeof $json !== 'undefined') {
  const picked = pickPersonaSnippets($json);
  return [{ json: { ...$json, ...picked } }];
}

if (typeof module !== 'undefined') {
  module.exports = { pickPersonaSnippets, toneRegisters, categoryScore, timeOfDayScore, toneScore, timeOfDayDomains };
}
