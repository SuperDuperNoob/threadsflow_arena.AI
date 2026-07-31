/**
 * n8n Code node — wf7 L4 step 2: draft reply using LLM with psychology techniques.
 *
 * Input $json:
 *   comment_text: the user's comment
 *   post_body: the original post text
 *   post_purpose: 'product' | 'persona'
 *   intent: classified intent
 *   reply_strategy: strategy for this intent
 *   psychology_techniques: array of techniques to apply
 *   product_name: (optional) product name if post_purpose='product'
 *   product_notes: (optional) product notes if post_purpose='product'
 *   persona_fragment: (optional) persona calibration snippets
 *
 * Output: adds `llm_system`, `llm_user`, `draft_metadata`
 */

function buildReplyPrompt(input) {
  const intent = input.intent || 'other';
  const strategy = input.reply_strategy || 'acknowledge';
  const techniques = input.psychology_techniques || [];
  const postPurpose = input.post_purpose || 'product';

  // Build system prompt based on intent and techniques
  let systemPrompt = `You are replying to a comment on a Threads post. Write a natural, helpful reply in casual Malaysian Malay (tak/nak/dah/je/lah/kan).

Context:
- Post purpose: ${postPurpose}
- Comment intent: ${intent}
- Reply strategy: ${strategy}
`;

  if (postPurpose === 'product' && input.product_name) {
    systemPrompt += `- Product: ${input.product_name}\n`;
    if (input.product_notes) {
      systemPrompt += `- Product notes: ${input.product_notes}\n`;
    }
  }

  systemPrompt += `\nHard rules:
- Max 180 characters (strict limit)
- 1-2 sentences only
- Use casual BM: tak, nak, dah, je, lah, kan, kot
- NO Indonesian: banget, nggak, bisa, butuh, udah, bikin
- NO hard-sell: "beli sekarang", "stok terhad", "wajib ada"
- NO exclamation marks unless intent is compliment
- Sound like a helpful friend, not a salesperson
`;

  // Add technique-specific guidance
  if (techniques.length > 0) {
    systemPrompt += `\nPsychology techniques to apply:\n`;
    techniques.forEach(tech => {
      switch (tech) {
        case 'mirror_last_three':
          systemPrompt += `- mirror_last_three: Repeat their last 1-3 words as a question to invite elaboration\n`;
          break;
        case 'tactical_empathy_label':
          systemPrompt += `- tactical_empathy_label: Acknowledge their emotion with "macam [frustrated/excited/confused] je" or "faham sangat"\n`;
          break;
        case 'calibrated_question':
          systemPrompt += `- calibrated_question: Ask "macam mana" or "untuk apa" not "kenapa" — invites context\n`;
          break;
        case 'late_night_dj_voice':
          systemPrompt += `- late_night_dj_voice: Use short declarative sentences with periods, state facts plainly\n`;
          break;
        case 'bury_boomerangs':
          systemPrompt += `- bury_boomerangs: Don't pivot back to yourself, answer their question fully first\n`;
          break;
        case 'listen_longer':
          systemPrompt += `- listen_longer: Ask 2 questions before sharing your take\n`;
          break;
        case 'leave_better':
          systemPrompt += `- leave_better: Include one specific useful detail (timing, comparison, warning, tip)\n`;
          break;
        case 'participation_loop':
          systemPrompt += `- participation_loop: Ask for specific input ("korang guna yang mana?") not broad opinions\n`;
          break;
        case 'belonging_signal':
          systemPrompt += `- belonging_signal: Use "kita" for struggles, "saya" for wins\n`;
          break;
      }
    });
  }

  systemPrompt += `\nOutput ONLY the reply text. No quotes, no preamble, no explanation.`;

  // Build user prompt
  let userPrompt = `Original post:\n${input.post_body}\n\n`;
  userPrompt += `User comment:\n${input.comment_text}\n\n`;
  userPrompt += `Write a helpful 1-2 sentence reply:`;

  return {
    llm_system: systemPrompt,
    llm_user: userPrompt,
    draft_metadata: {
      intent,
      strategy,
      techniques,
      post_purpose: postPurpose,
      has_product: postPurpose === 'product' && !!input.product_name,
    },
  };
}

// n8n entry point
if (typeof $ !== 'undefined' && typeof $json !== 'undefined') {
  const result = buildReplyPrompt($json);
  return [{ json: { ...$json, ...result } }];
}

if (typeof module !== 'undefined') {
  module.exports = { buildReplyPrompt };
}
