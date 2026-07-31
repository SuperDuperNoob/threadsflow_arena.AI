/**
 * n8n Code node — wf6/wf3 step: apply subtle LLM variations to posts before publishing.
 *
 * This node takes the final approved post text and passes it through an LLM to make
 * subtle variations while preserving meaning, tone, and structure. The goal is to ensure
 * no two posts are exactly identical, even if they're based on the same template.
 *
 * Examples:
 *   Original: "Hello world"
 *   Variations: "Hi world", "Hey world", "Hello there", "Hi everyone"
 *
 * Input $json:
 *   text: the final approved post text
 *   tone: the tone/voice to preserve
 *   settings: { variation: { enabled, max_changes, preserve_hashtags, preserve_mentions } }
 *
 * Output: { original_text, varied_text, changes_made }
 */

const DEFAULT_SETTINGS = {
  enabled: true,
  max_changes: 3,           // max number of word/phrase substitutions
  preserve_hashtags: true,   // don't change #hashtags
  preserve_mentions: true,   // don't change @mentions
  preserve_links: true,      // don't change URLs
  preserve_emoji: true,      // don't change emoji
  min_length_for_variation: 50,  // only vary posts longer than this
  temperature: 0.3,          // low temperature for controlled variations
  model: 'gpt-3.5-turbo',    // use cheap/fast model for variations
};

/**
 * Build the variation prompt for the LLM.
 */
function buildVariationPrompt(text, tone, settings) {
  const s = { ...DEFAULT_SETTINGS, ...settings };

  const constraints = [];
  if (s.preserve_hashtags) constraints.push('- Keep all #hashtags exactly as they are');
  if (s.preserve_mentions) constraints.push('- Keep all @mentions exactly as they are');
  if (s.preserve_links) constraints.push('- Keep all URLs exactly as they are');
  if (s.preserve_emoji) constraints.push('- Keep all emoji exactly as they are');

  const systemPrompt = `You are a text variation engine. Your job is to make subtle changes to text while preserving its meaning, tone, and structure.

Rules:
- Make ONLY 1-${s.max_changes} small changes (word substitutions, phrase rewording)
- Preserve the original tone: ${tone}
- Do NOT change the meaning or add new information
- Do NOT make the text longer or shorter (±10% max)
- Do NOT change proper nouns, numbers, or technical terms
${constraints.join('\n')}

Examples of GOOD variations:
- "Hello world" → "Hi world" or "Hey world" or "Hello there"
- "This is amazing" → "This is incredible" or "This is awesome" or "This is fantastic"
- "I love this" → "I really love this" or "I'm loving this" or "I absolutely love this"
- "Check this out" → "Take a look at this" or "Have a look at this"

Examples of BAD variations (DO NOT DO THIS):
- Changing meaning: "I love this" → "I hate this" ❌
- Adding information: "Hello world" → "Hello world, how are you?" ❌
- Changing structure: "Hello world" → "World, hello" ❌
- Too many changes: "Hello world" → "Greetings planet" ❌

Output ONLY the varied text. No explanations, no preamble.`;

  const userPrompt = `Original text:
${text}

Varied text:`;

  return { systemPrompt, userPrompt };
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
function applyVariation(text, tone, settings) {
  const s = { ...DEFAULT_SETTINGS, ...settings };

  if (!shouldVaryText(text, s)) {
    return {
      original_text: text,
      varied_text: text,
      changes_made: 0,
      skipped: true,
      skip_reason: text.length < s.min_length_for_variation ? 'too_short' : 'disabled',
    };
  }

  const { systemPrompt, userPrompt } = buildVariationPrompt(text, tone, s);

  // In n8n workflow, this would be an HTTP request to the LLM
  // For now, return the prompts for the workflow to use
  return {
    original_text: text,
    varied_text: text,  // placeholder, will be replaced by LLM response
    system_prompt: systemPrompt,
    user_prompt: userPrompt,
    settings: {
      temperature: s.temperature,
      model: s.model,
      max_tokens: Math.ceil(text.length * 1.2),  // allow up to 20% longer
    },
    changes_made: 0,
    skipped: false,
  };
}

// n8n entry point
if (typeof $ !== 'undefined' && typeof $json !== 'undefined') {
  const settings = $json.settings?.variation || {};
  const result = applyVariation($json.text, $json.tone || 'casual', settings);
  return [{ json: { ...$json, ...result } }];
}

if (typeof module !== 'undefined') {
  module.exports = { applyVariation, shouldVaryText, validateVariation, buildVariationPrompt };
}
