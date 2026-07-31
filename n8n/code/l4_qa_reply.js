/**
 * n8n Code node — wf7 L4 step 3: QA gate for drafted replies.
 *
 * Similar to qa_persona.js but for replies. Enforces:
 *   - Length cap (180 chars default, configurable)
 *   - No hard-sell language
 *   - No Indonesian words
 *   - No link/CTA unless the user explicitly asked for a link
 *   - No making up product specs
 *   - Psychology technique validation (check the assigned technique is present)
 *   - No aggressive empathy scripts
 *
 * Input $json:
 *   reply_text: drafted reply from LLM
 *   intent: classified intent
 *   psychology_techniques: assigned techniques
 *   post_purpose: 'product' | 'persona'
 *   settings: { max_reply_length, ... }
 */

const INDONESIAN_BAN = /\b(banget|nggak|gak|aja|udah|bikin|gimana|kalian|doang|cowok|cewek|gue|deh|dong|sih)\b/i;
const FALSE_FRIENDS = [
  [/\bbisa\b/i, 'bisa = venom in BM; use boleh'],
  [/\bbutuh\b/i, 'butuh = vulgar in BM; use perlu'],
  [/\bpusing\b(?!\s+(kiri|kanan|sana))/i, 'pusing = turn in BM; use pening/sakit kepala'],
];

// Hard-sell language that should NEVER appear in replies
const HARD_SELL = /\b(beli sekarang|cepat sebelum|stok terhad|wajib ada|game.?changer|must.?have|berbaloi sangat|power gila|padu gila)\b/i;

// Link/CTA language — only allowed if intent is link_inquiry
const LINK_CTA = /\b(klik link|check.?out|order sekarang|DM saya|PM saya|wasap saya|whatsapp saya)\b/i;

// Aggressive empathy scripts (banned from psychology seed)
const AGGRESSIVE_EMPATHY = /\b(saya faham sangat (masalah|keadaan|situasi) (anda|korang|kau)|saya tahu (anda|korang|kau) rasa)\b/i;

// Psychology technique markers — used to validate that the assigned technique is present
const TECHNIQUE_MARKERS = {
  mirror_last_three: /\?\s*$/,  // ends with a question (mirroring invites elaboration)
  tactical_empathy_label: /\b(macam|nampak|faham|macam .+ je)\b/i,  // labels emotion
  calibrated_question: /\b(macam mana|untuk apa|berapa lama|kat mana)\b/i,  // asks "how/what"
  late_night_dj_voice: /^[^.!?]*\.\s*[^.!?]*\.\s*$/,  // short declarative sentences with periods
  bury_boomerangs: /\?/,  // asks about them, not pivoting to self
  listen_longer: /\?.*\?/,  // asks 2+ questions
  leave_better: /\b(tapi|sebab|kalau|tunggu|tips?|petua|cara)\b/i,  // gives useful detail
  participation_loop: /\?/,  // asks for input
  belonging_signal: /\b(kita semua|kita pun)\b/i,  // uses "kita"
  reciprocity_first: /\b(petua|tip|cara|boleh cuba)\b/i,  // gives value
};

function qaReply(input) {
  const settings = input.settings ?? {};
  const maxLen = settings.max_reply_length ?? 180;
  const reasons = [];
  let text = String(input.reply_text ?? '').trim();

  // Strip wrappers
  text = text.replace(/^```[\w]*\n?|```$/g, '').trim();
  text = text.replace(/^["'""](.*)["'""]$/s, '$1').trim();
  text = text.replace(/^(Here'?s|Reply:|Response:)\s*:?\s*/i, '').trim();

  // 1. Length
  if (text.length > maxLen) {
    reasons.push(`reply too long: ${text.length} > ${maxLen}`);
  }
  if (text.length < 3) {
    reasons.push('reply too short');
  }

  // 2. Indonesian + false friends
  if (INDONESIAN_BAN.test(text)) reasons.push('contains Indonesian word(s)');
  for (const [rx, why] of FALSE_FRIENDS) {
    if (rx.test(text)) { reasons.push(`false friend: ${why}`); break; }
  }

  // 3. Hard-sell language
  if (HARD_SELL.test(text)) reasons.push('contains hard-sell language');

  // 4. Link/CTA — only allowed if intent is link_inquiry
  if (LINK_CTA.test(text) && input.intent !== 'link_inquiry') {
    reasons.push('contains unsolicited link/CTA');
  }

  // 5. Aggressive empathy
  if (AGGRESSIVE_EMPATHY.test(text)) reasons.push('aggressive empathy script detected');

  // 6. Shouting
  const shout = (text.match(/\b[A-Z]{4,}\b/g) ?? [])
    .filter(w => !/^(RM|OK|USB|LED|PDF|XL|XXL|COD|DIY|FYI|KL|JB|PJ)$/.test(w));
  if (shout.length >= 2) reasons.push(`${shout.length} ALL-CAPS words`);

  // 7. Emoji cap (max 1 for replies)
  const emojis = text.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu) ?? [];
  if (emojis.length > 1) reasons.push(`${emojis.length} emoji > cap 1`);

  // 8. Psychology technique validation — at least one assigned technique should be present
  const techniques = input.psychology_techniques ?? [];
  if (techniques.length > 0) {
    const hasTechnique = techniques.some(t => {
      const marker = TECHNIQUE_MARKERS[t];
      return marker ? marker.test(text) : true;
    });
    if (!hasTechnique) {
      reasons.push(`no assigned psychology technique detected: ${techniques.join(', ')}`);
    }
  }

  // 9. Persona posts should not mention products/prices
  if (input.post_purpose === 'persona') {
    if (/\b(RM\s?\d+|harga|beli|shopee|lazada|link)\b/i.test(text)) {
      reasons.push('persona reply mentions product/price/link');
    }
  }

  // 10. No making up specs — if the reply contains numbers not in the post, flag it
  // (This is a soft check; the LLM should be prompted not to make up specs)
  const postNumbers = (input.post_body ?? '').match(/\d+/g) ?? [];
  const replyNumbers = text.match(/\d+/g) ?? [];
  const newNumbers = replyNumbers.filter(n => !postNumbers.includes(n));
  if (newNumbers.length > 2 && input.intent === 'compatibility_inquiry') {
    reasons.push('reply contains many numbers not in post (possible spec fabrication)');
  }

  return {
    pass: reasons.length === 0,
    reasons,
    cleaned: text,
    stats: {
      chars: text.length,
      emoji: emojis.length,
      intent: input.intent,
      techniques_applied: techniques,
    },
  };
}

// n8n entry point
if (typeof $ !== 'undefined' && typeof $json !== 'undefined') {
  const out = qaReply($json);
  return [{ json: { ...$json, ...out } }];
}

if (typeof module !== 'undefined') {
  module.exports = { qaReply };
}
