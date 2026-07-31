/**
 * n8n Code node — wf7 L4 step 1: classify comment intent.
 *
 * Uses keyword/pattern matching to classify the user's comment into one of
 * 9 intent categories. This determines which reply strategy and psychology
 * techniques to apply.
 *
 * Input $json:
 *   comment_text: the user's comment
 *   post_body: the original post text (for context)
 *   post_purpose: 'product' | 'persona'
 *
 * Output: adds `intent`, `intent_confidence`, `reply_strategy`, `psychology_techniques`
 */

const INTENT_PATTERNS = {
  link_inquiry: {
    patterns: [
      /\b(link|beli (kat|di) mana|mana nak (beli|cari|dapat)|shopee|lazada|tiktok shop)\b/i,
      /\b(pm (link|harga)|drop link|bagi link|hantar link)\b/i,
      /\b(where to (buy|get)|how to (buy|order))\b/i,
    ],
    weight: 10,
  },
  price_inquiry: {
    patterns: [
      /\b(harga|berapa (rm|ringgit)|mahal|murah|berapat)\b/i,
      /\b(price|cost|how much|expensive|cheap)\b/i,
      /\b(rm\s?\d+)/i,
    ],
    weight: 9,
  },
  experience_inquiry: {
    patterns: [
      /\b(tahan (lama|berapa)|ok (ke|tak)|bagus (ke|tak)|berkesan|berbaloi)\b/i,
      /\b(pernah (guna|cuba|try)|dah (guna|cuba|pakai)|macam mana (guna|hasil))\b/i,
      /\b(worth it|recommended|review|experience|quality)\b/i,
    ],
    weight: 8,
  },
  compatibility_inquiry: {
    patterns: [
      /\b(boleh (guna|pakai|masuk)|sesuai (untuk|dengan)|compatible|support)\b/i,
      /\b(saiz|size|besar (mana|sangat)|kecil|muat)\b/i,
      /\b(iphone|android|samsung|laptop|windows|mac)\b/i,
      /\b(bateri|battery|tahan berapa (jam|hari))\b/i,
    ],
    weight: 7,
  },
  complaint: {
    patterns: [
      /\b(tak (ok|bagus|puas hati|berkesan|tahan)|rosak|rosak|problem|issue|masalah)\b/i,
      /\b(menyesal|rugi|scam|tipu|fake|palsu)\b/i,
      /\b(disappointed|broken|defective|waste of money)\b/i,
    ],
    weight: 6,
  },
  compliment: {
    patterns: [
      /\b(best|bagus|cantik|comel|lawak|nice|great|good|awesome|wow)\b/i,
      /\b(suka|sangat suka|love it|terbaik|padu|mantap)\b/i,
      /\b(thank you|terima kasih|thanks|tq)\b/i,
    ],
    weight: 4,
  },
  question: {
    patterns: [
      /\?$/,
      /\b(kenapa|macam mana|bila|apa|siapa|how|why|when|what|who)\b/i,
    ],
    weight: 5,
  },
  casual_banter: {
    patterns: [
      /\b(haha|lol|😂|🤣|kelakar|lawak)\b/i,
      /\b(same|sama|relate|setuju|betul)\b/i,
    ],
    weight: 2,
  },
};

// Psychology techniques mapped to intents
const INTENT_TECHNIQUES = {
  link_inquiry:    ['leave_better', 'calibrated_question'],
  price_inquiry:   ['tactical_empathy_label', 'leave_better'],
  experience_inquiry: ['mirror_last_three', 'leave_better'],
  compatibility_inquiry: ['calibrated_question', 'leave_better'],
  complaint:       ['tactical_empathy_label', 'bury_boomerangs', 'listen_longer'],
  compliment:      ['bury_boomerangs', 'participation_loop'],
  question:        ['mirror_last_three', 'calibrated_question'],
  casual_banter:   ['belonging_signal', 'participation_loop'],
  other:           ['listen_longer'],
};

// Reply strategies mapped to intents
const INTENT_STRATEGIES = {
  link_inquiry:    'point_to_link',
  price_inquiry:   'state_price_or_link',
  experience_inquiry: 'share_experience',
  compatibility_inquiry: 'answer_facts',
  complaint:       'empathize_and_help',
  compliment:      'thank_and_engage',
  question:        'answer_and_ask_back',
  casual_banter:   'banter_back',
  other:           'acknowledge',
};

function classifyIntent(input) {
  const text = (input.comment_text ?? '').trim();
  if (!text) return { intent: 'other', confidence: 0 };

  const scores = {};
  for (const [intent, config] of Object.entries(INTENT_PATTERNS)) {
    let score = 0;
    for (const pattern of config.patterns) {
      if (pattern.test(text)) {
        score += config.weight;
      }
    }
    if (score > 0) scores[intent] = score;
  }

  // Find highest scoring intent
  let bestIntent = 'other';
  let bestScore = 0;
  for (const [intent, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent;
    }
  }

  // Confidence is normalised score (0-1)
  const maxPossible = Math.max(...Object.values(INTENT_PATTERNS).map(c =>
    c.weight * c.patterns.length));
  const confidence = maxPossible > 0 ? Math.min(1, bestScore / maxPossible) : 0;

  return {
    intent: bestIntent,
    intent_confidence: Math.round(confidence * 100) / 100,
    intent_scores: scores,
    reply_strategy: INTENT_STRATEGIES[bestIntent] ?? 'acknowledge',
    psychology_techniques: INTENT_TECHNIQUES[bestIntent] ?? ['listen_longer'],
  };
}

// n8n entry point
if (typeof $ !== 'undefined' && typeof $json !== 'undefined') {
  const result = classifyIntent($json);
  return [{ json: { ...$json, ...result } }];
}

if (typeof module !== 'undefined') {
  module.exports = { classifyIntent, INTENT_PATTERNS, INTENT_TECHNIQUES, INTENT_STRATEGIES };
}
