/**
 * n8n Code node — wf6/wf3 step: apply subtle LLM variations to posts before publishing.
 *
 * This node takes the final approved post text and passes it through an LLM to make
 * subtle variations while preserving meaning, tone, and structure. The goal is to ensure
 * no two posts are exactly identical, even if they're based on the same template.
 *
 * NOW WITH:
 * - Integration with settings.llm (custom base URL, API key, model)
 * - Persona snippet integration for authentic Malaysian variations
 * - Malaysian Malay language preservation
 * - Tone/persona awareness
 *
 * Input $json:
 *   text: the final approved post text
 *   tone: the tone/voice to preserve (gaul, deadpan, warm_sibling, etc.)
 *   persona_snippets: array of Malaysian persona snippets for reference
 *   settings.llm: LLM configuration (base_url, api_key, model)
 *   settings.variation: variation settings
 *
 * Output: { original_text, varied_text, llm_config, system_prompt, user_prompt }
 */

const DEFAULT_SETTINGS = {
  enabled: true,
  max_changes: 3,           // max number of word/phrase substitutions
  preserve_hashtags: true,   // don't change #hashtags
  preserve_mentions: true,   // don't change @mentions
  preserve_links: true,      // don't change URLs
  preserve_emoji: true,      // don't change emoji
  min_length_for_variation: 50,  // only vary posts longer than this
  temperature: 0.4,          // slightly higher for more natural variations
  max_tokens: 500,           // max response length
};

/**
 * Build the variation prompt for the LLM, incorporating persona snippets and tone.
 */
function buildVariationPrompt(text, tone, personaSnippets, settings) {
  const s = { ...DEFAULT_SETTINGS, ...settings };

  // Select 2-3 persona snippets that match the tone for reference
  const relevantSnippets = selectRelevantSnippets(personaSnippets, tone, 3);

  const constraints = [];
  if (s.preserve_hashtags) constraints.push('- Keep all #hashtags exactly as they are');
  if (s.preserve_mentions) constraints.push('- Keep all @mentions exactly as they are');
  if (s.preserve_links) constraints.push('- Keep all URLs exactly as they are');
  if (s.preserve_emoji) constraints.push('- Keep all emoji exactly as they are');

  // Tone-specific guidance
  const toneGuidance = getToneGuidance(tone);

  const systemPrompt = `You are a Malaysian Malay text variation engine. Your job is to make subtle changes to Malaysian Malay text while preserving its meaning, tone, and authentic Malaysian voice.

CRITICAL LANGUAGE RULES:
- Output MUST be in casual Malaysian Malay (Bahasa Melayu pasar/harian)
- Use Malaysian contractions: tak, nak, dah, je, lah, kan, kot, memang, boleh
- Mix in common English words naturally (rojak style): "memang best", "sangat nice", "boleh try"
- NEVER use Indonesian words: banget, nggak, gak, aja, udah, bikin, gimana, kalian, doang, cowok, cewek, gue, deh, dong, sih
- NEVER use formal Malay: tidak, hendak, sudah, sahaja, bolehkah, di mana
- Currency is RM (ringgit), never Rp or rupiah

TONE TO PRESERVE: ${tone}
${toneGuidance}

VARIATION RULES:
- Make ONLY 1-${s.max_changes} small changes (word substitutions, phrase rewording)
- Do NOT change the meaning or add new information
- Do NOT make the text longer or shorter (±10% max)
- Do NOT change proper nouns, numbers, or technical terms
${constraints.join('\n')}

EXAMPLES OF GOOD MALAYSIAN MALAY VARIATIONS:
- "Memang best gila" → "Memang best sangat" / "Memang super best" / "Best gila lah"
- "Dah cuba belum?" → "Dah try belum?" / "Pernah cuba?" / "Dah rasa belum?"
- "Harga RM50 je" → "RM50 sahaja" / "Cuma RM50" / "RM50 je weh"
- "Korang kena try" → "Korang patut cuba" / "Kena try ni" / "Cuba lah korang"

EXAMPLES OF BAD VARIATIONS (DO NOT DO THIS):
- Changing to Indonesian: "Memang best" → "Memang bagus banget" ❌ (Indonesian "banget")
- Changing to formal Malay: "Tak nak" → "Tidak mahu" ❌ (too formal)
- Changing meaning: "Suka sangat" → "Tak suka" ❌ (opposite meaning)
- Adding information: "Best gila" → "Best gila, murah pulak tu" ❌ (added new info)
${relevantSnippets.length > 0 ? `

REFERENCE: Here are examples of authentic Malaysian Malay writing style (borrow rhythm and vocabulary patterns, don't copy exact phrases):
${relevantSnippets.map((s, i) => `${i + 1}. [${s.register}] ${s.text.slice(0, 150)}...`).join('\n')}` : ''}

Output ONLY the varied text in Malaysian Malay. No explanations, no preamble, no English translation.`;

  const userPrompt = `Original text (Malaysian Malay):
${text}

Varied text (Malaysian Malay):`;

  return { systemPrompt, userPrompt };
}

/**
 * Select persona snippets that match the tone for reference.
 */
function selectRelevantSnippets(snippets, tone, count = 3) {
  if (!snippets || snippets.length === 0) return [];

  // Map tones to registers
  const toneToRegister = {
    gaul: ['conversational', 'casual'],
    deadpan: ['neutral', 'dry'],
    warm_sibling: ['warm', 'empathetic'],
    makcik: ['storytelling', 'casual'],
    chaotic: ['casual', 'energetic'],
    minimal: ['neutral', 'concise'],
  };

  const targetRegisters = toneToRegister[tone] || ['conversational'];

  // Filter and score snippets
  const scored = snippets.map(snippet => {
    let score = 0;
    if (targetRegisters.includes(snippet.register)) score += 2;
    if (snippet.text && snippet.text.length > 50 && snippet.text.length < 300) score += 1;
    return { ...snippet, score };
  });

  // Sort by score and return top N
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, count);
}

/**
 * Get tone-specific guidance for the prompt.
 */
function getToneGuidance(tone) {
  const guidance = {
    gaul: `- Keep it casual and street-smart
- Use slang: weh, lah, kan, kot, memang, gila, best, power
- Mix English naturally: "memang nice", "satu lagi level"`,
    
    deadpan: `- Keep it dry and understated
- Avoid exclamation marks
- Use flat delivery: "ok lah", "boleh tahan", "not bad"`,
    
    warm_sibling: `- Keep it warm and empathetic
- Use caring language: "faham", "takpe", "sabar je lah"
- Show understanding: "I feel you", "same here"`,
    
    makcik: `- Keep it chatty and story-like
- Use filler words: "ha", "eh", "ala", "ish"
- Add personal touches: "makcik sebelah rumah", "kawan I"`,
    
    chaotic: `- Keep it energetic and scattered
- Use exclamation marks sparingly
- Jump between thoughts: "eh wait", "btw", "oh ya"`,
    
    minimal: `- Keep it short and punchy
- Use fragments: "Best.", "Memang.", "Cuba lah."
- Avoid unnecessary words`,
  };

  return guidance[tone] || '- Keep the original tone and style';
}

/**
 * Check if text should be varied (length, content checks).
 */
function shouldVaryText(text, settings) {
  const s = { ...DEFAULT_SETTINGS, ...settings };

  if (!s.enabled) return false;
  if (text.length < s.min_length_for_variation) return false;

  // Don't vary if it's mostly hashtags/mentions/links
  const cleanText = text
    .replace(/#\w+/g, '')
    .replace(/@\w+/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .trim();

  if (cleanText.length < 20) return false;

  return true;
}

/**
 * Validate that the variation is acceptable (not too different).
 */
function validateVariation(original, varied, settings) {
  const s = { ...DEFAULT_SETTINGS, ...settings };

  // Check length difference (max 10%)
  const lenDiff = Math.abs(varied.length - original.length) / original.length;
  if (lenDiff > 0.1) {
    console.log(`Variation rejected: length difference too large (${(lenDiff * 100).toFixed(1)}%)`);
    return false;
  }

  // Check that hashtags/mentions/links are preserved
  if (s.preserve_hashtags) {
    const origHashtags = original.match(/#\w+/g) || [];
    const varHashtags = varied.match(/#\w+/g) || [];
    if (JSON.stringify(origHashtags) !== JSON.stringify(varHashtags)) {
      console.log('Variation rejected: hashtags changed');
      return false;
    }
  }

  if (s.preserve_mentions) {
    const origMentions = original.match(/@\w+/g) || [];
    const varMentions = varied.match(/@\w+/g) || [];
    if (JSON.stringify(origMentions) !== JSON.stringify(varMentions)) {
      console.log('Variation rejected: mentions changed');
      return false;
    }
  }

  if (s.preserve_links) {
    const origLinks = original.match(/https?:\/\/\S+/g) || [];
    const varLinks = varied.match(/https?:\/\/\S+/g) || [];
    if (JSON.stringify(origLinks) !== JSON.stringify(varLinks)) {
      console.log('Variation rejected: links changed');
      return false;
    }
  }

  // Check that text is not identical (variation should actually change something)
  if (original.trim() === varied.trim()) {
    console.log('Variation rejected: no changes made');
    return false;
  }

  return true;
}

/**
 * Apply variation to text (this would call the LLM in the workflow).
 */
function applyVariation(text, tone, personaSnippets, settings) {
  const s = { ...DEFAULT_SETTINGS, ...settings.variation };
  const llmConfig = settings.llm || {};

  if (!shouldVaryText(text, s)) {
    return {
      original_text: text,
      varied_text: text,
      changes_made: 0,
      skipped: true,
      skip_reason: text.length < s.min_length_for_variation ? 'too_short' : 'disabled',
    };
  }

  const { systemPrompt, userPrompt } = buildVariationPrompt(text, tone, personaSnippets, s);

  // Build LLM configuration from settings
  const llmSettings = {
    base_url: llmConfig.base_url || 'https://api.openai.com/v1',
    api_key: llmConfig.api_key || '',
    model: s.model || llmConfig.model_variation || llmConfig.model || 'gpt-3.5-turbo',
    temperature: s.temperature,
    max_tokens: s.max_tokens || Math.ceil(text.length * 1.5),
  };

  // In n8n workflow, this would be an HTTP request to the LLM
  // For now, return the prompts for the workflow to use
  return {
    original_text: text,
    varied_text: text,  // placeholder, will be replaced by LLM response
    system_prompt: systemPrompt,
    user_prompt: userPrompt,
    llm_config: llmSettings,
    changes_made: 0,
    skipped: false,
  };
}

// n8n entry point
if (typeof $ !== 'undefined' && typeof $json !== 'undefined') {
  const settings = $json.settings || {};
  const personaSnippets = $json.persona_snippets || $json.cfg?.persona_snippets || [];
  const result = applyVariation($json.text, $json.tone || 'gaul', personaSnippets, settings);
  return [{ json: { ...$json, ...result } }];
}

if (typeof module !== 'undefined') {
  module.exports = { applyVariation, shouldVaryText, validateVariation, buildVariationPrompt };
}
