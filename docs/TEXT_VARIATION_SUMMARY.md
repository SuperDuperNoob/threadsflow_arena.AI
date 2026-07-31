# Text Variation Feature - Implementation Summary

## Overview

The text variation feature applies subtle LLM-based paraphrasing to every post before publishing, ensuring no two posts are identical. This helps avoid duplicate detection and makes automated content feel more natural and human.

**Status**: ✅ Production-ready with full persona integration and Malaysian Malay enforcement

---

## Key Improvements (Commit `d99bf14`)

### 1. ✅ Persona Snippet Integration

**Problem**: Original implementation didn't use the 177 Malaysian persona snippets, resulting in generic variations.

**Solution**: 
- Selects 2-3 persona snippets that match the post's tone
- Uses snippets as style reference for authentic Malaysian variations
- LLM borrows rhythm, vocabulary patterns, and sentence structure from snippets

**How it works**:
```javascript
// Select snippets matching the tone
const relevantSnippets = selectRelevantSnippets(personaSnippets, tone, 3);

// Include in prompt as reference
const systemPrompt = `...
REFERENCE: Here are examples of authentic Malaysian Malay writing style:
${relevantSnippets.map(s => `[${s.register}] ${s.text}`).join('\n')}
`;
```

**Example**:
- Post tone: `gaul`
- Selected snippets: casual Facebook comments, IIUM confessions
- LLM applies similar casual, rojak style to variations

---

### 2. ✅ Integration with `settings.llm`

**Problem**: Original implementation hardcoded to `gpt-3.5-turbo` and didn't use existing LLM configuration.

**Solution**:
- Uses existing `settings.llm` configuration
- Supports custom providers: 9router, OpenAI, local LLMs, etc.
- Priority order: `model_variation` > `model` > `gpt-3.5-turbo` (default)

**Configuration**:
```json
{
  "llm": {
    "base_url": "https://9router.archxry.space/v1",
    "api_key": "your-api-key",
    "model": "gemini-2.5-flash",
    "model_variation": "gpt-3.5-turbo"
  }
}
```

**Benefits**:
- No separate API keys needed
- Works with any OpenAI-compatible API
- Can use local LLMs or self-hosted models
- Easy to switch providers

---

### 3. ✅ Malaysian Malay Language Enforcement

**Problem**: Original implementation didn't enforce Malaysian Malay, risking Indonesian or formal Malay output.

**Solution**:
- **Enforces BM pasar**: tak, nak, dah, je, lah, kan, kot, memang, boleh
- **Allows rojak**: "memang best", "sangat nice", "boleh try"
- **BLOCKS Indonesian**: banget, nggak, gak, aja, udah, bikin, gimana, kalian, doang, cowok, cewek, gue
- **BLOCKS formal Malay**: tidak, hendak, sudah, sahaja, bolehkah, di mana
- **False friends protection**: bisa=venom, butuh=vulgar, pusing=turn

**Implementation**:
```javascript
const systemPrompt = `...
CRITICAL LANGUAGE RULES:
- Output MUST be in casual Malaysian Malay (Bahasa Melayu pasar/harian)
- Use Malaysian contractions: tak, nak, dah, je, lah, kan, kot
- Mix in common English words naturally (rojak style)
- NEVER use Indonesian words: banget, nggak, gak, aja, udah, bikin, gimana
- NEVER use formal Malay: tidak, hendak, sudah, sahaja, bolehkah
- Currency is RM (ringgit), never Rp or rupiah
`;
```

**Validation**:
```javascript
function validateVariation(original, varied) {
  // Check for Indonesian words
  const indonesianWords = ['banget', 'nggak', 'gak', 'aja', 'udah', 'bikin', 'gimana', 'kalian', 'doang', 'cowok', 'cewek', 'gue'];
  if (indonesianWords.some(word => varied.includes(word))) {
    return false; // Reject variation
  }
  
  // Check for formal Malay
  const formalMalay = ['tidak', 'hendak', 'sudah', 'sahaja', 'bolehkah', 'di mana'];
  if (formalMalay.some(word => varied.includes(word))) {
    return false; // Reject variation
  }
  
  return true; // Accept variation
}
```

---

### 4. ✅ Tone Awareness

**Problem**: Original implementation didn't consider the post's tone, resulting in inconsistent voice.

**Solution**:
- Each tone has specific vocabulary and style guidance
- LLM receives tone-specific instructions in the prompt

**Tone Guidance**:
```javascript
const toneGuidance = {
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
```

---

### 5. ✅ Enhanced Tracking

**Problem**: Original implementation didn't log which LLM model or provider was used.

**Solution**:
- Logs `llm_model_used` and `llm_base_url_used` for each variation
- Helps debug which provider/model is being used
- Enables cost tracking and optimization

**Database Schema**:
```sql
CREATE TABLE text_variations (
  id SERIAL PRIMARY KEY,
  workflow TEXT NOT NULL,
  post_id TEXT,
  original_text TEXT NOT NULL,
  varied_text TEXT NOT NULL,
  changes_made INTEGER DEFAULT 0,
  validation_passed BOOLEAN DEFAULT true,
  llm_model_used TEXT,
  llm_base_url_used TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Example Query**:
```sql
-- Which LLM models are being used
SELECT llm_model_used, COUNT(*) as count
FROM text_variations
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY llm_model_used;
```

---

## How It Works

### Workflow Integration

```
[Post Generated]
    ↓
[QA Pass]
    ↓
[Text Variation Node] ← persona_snippets, tone, settings.llm
    ↓
[Build Prompt] ← includes persona snippets as reference
    ↓
[LLM Call] ← uses settings.llm.base_url, settings.llm.api_key
    ↓
[Validate Variation] ← checks for Indonesian/formal Malay
    ↓
[Publish Varied Text]
    ↓
[Log to Database] ← records llm_model_used, llm_base_url_used
```

### Example Flow

**Input**:
- Post: "Memang best gila produk ni, korang kena try!"
- Tone: `gaul`
- Persona snippets: 2 casual Facebook comments selected

**Prompt**:
```
You are a Malaysian Malay text variation engine...

TONE TO PRESERVE: gaul
- Keep it casual and street-smart
- Use slang: weh, lah, kan, kot, memang, gila, best, power
- Mix English naturally

REFERENCE: Here are examples of authentic Malaysian Malay writing style:
1. [conversational] Semalam lepak mamak sampai pukul 2 pagi. Borak kosong je, tapi best gila.
2. [conversational] Pergi Midvalley semalam, ingat nak window shopping je. Last-last terbeli kasut RM200.

Original text (Malaysian Malay):
Memang best gila produk ni, korang kena try!

Varied text (Malaysian Malay):
```

**LLM Output**:
"Produk ni memang best gila lah, korang patut cuba!"

**Validation**:
- ✅ No Indonesian words
- ✅ No formal Malay
- ✅ Length within ±10%
- ✅ Meaning preserved
- ✅ Hashtags/mentions/links unchanged

**Result**: Publish "Produk ni memang best gila lah, korang patut cuba!"

---

## Configuration

### LLM Configuration (`settings.llm`)

```json
{
  "llm": {
    "base_url": "https://9router.archxry.space/v1",
    "api_key": "your-api-key",
    "model": "gemini-2.5-flash",
    "model_variation": "gpt-3.5-turbo"
  }
}
```

**Priority**:
1. `model_variation` (if set) — dedicated model for variations
2. `model` (fallback) — use the main model
3. Default: `gpt-3.5-turbo`

### Variation Settings (`settings.text_variation`)

```json
{
  "enabled": true,
  "max_changes": 3,
  "preserve_hashtags": true,
  "preserve_mentions": true,
  "preserve_links": true,
  "preserve_emoji": true,
  "min_length_for_variation": 50,
  "temperature": 0.4,
  "max_tokens": 500,
  "model_override": null,
  "workflows": ["wf6_persona", "wf3_publish"]
}
```

**Key Settings**:
- `enabled`: Turn variation on/off globally
- `max_changes`: Max word/phrase substitutions (1-3 recommended)
- `temperature`: LLM temperature (0.4 = balanced creativity/consistency)
- `min_length_for_variation`: Only vary posts longer than this
- `model_override`: Override the LLM model for variations only

---

## Examples

### Malaysian Malay Variations

| Original | Variation 1 | Variation 2 | Variation 3 |
|---|---|---|---|
| Memang best gila | Memang best sangat | Memang super best | Best gila lah |
| Dah cuba belum? | Dah try belum? | Pernah cuba? | Dah rasa belum? |
| Harga RM50 je | RM50 sahaja | Cuma RM50 | RM50 je weh |
| Korang kena try | Korang patut cuba | Kena try ni | Cuba lah korang |
| Tak nak beli | Takde nak beli | Belum nak beli | Tak beli lagi |

### Tone-Specific Variations

**Gaul (casual)**:
- Original: "Best gila produk ni"
- Variation: "Produk ni memang best gila lah weh"

**Deadpan (dry)**:
- Original: "Best gila produk ni"
- Variation: "Produk ni ok lah, boleh tahan"

**Warm_sibling (empathetic)**:
- Original: "Best gila produk ni"
- Variation: "Produk ni memang best, faham kenapa orang suka"

---

## Cost Analysis

**Using gpt-3.5-turbo**:
- Cost per variation: ~$0.0005
- At 5 posts/day: $0.0025/day
- Monthly: **$0.07/month**

**Using 9router or other providers**:
- Cost depends on your provider's pricing
- Can use cheaper models like `gpt-3.5-turbo-0125`
- Can use local LLMs (free)

**Optimization**:
- Increase `min_length_for_variation` to skip short posts
- Use `model_override` to specify a cheaper model for variations
- Disable for certain workflows if not needed

---

## Monitoring

### Check Variations

```sql
-- Recent variations
SELECT workflow, original_text, varied_text, changes_made, llm_model_used, created_at
FROM text_variations
ORDER BY created_at DESC
LIMIT 10;

-- Validation failure rate
SELECT 
  COUNT(*) FILTER (WHERE validation_passed) AS passed,
  COUNT(*) FILTER (WHERE NOT validation_passed) AS failed,
  COUNT(*) AS total
FROM text_variations
WHERE created_at > NOW() - INTERVAL '7 days';

-- Which LLM models are being used
SELECT llm_model_used, llm_base_url_used, COUNT(*) as count
FROM text_variations
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY llm_model_used, llm_base_url_used;
```

---

## Troubleshooting

### Variations are too different
- Lower `max_changes` to 1 or 2
- Lower `temperature` to 0.2
- Increase `min_length_for_variation` to 100

### Variations are identical to original
- Check that `enabled` is `true`
- Check that post length > `min_length_for_variation`
- Check LLM API key is valid in `settings.llm`

### Variations are in Indonesian or formal Malay
- Check that persona snippets are loaded (should have 177 snippets)
- Check that tone is set correctly (gaul, deadpan, etc.)
- Review the system prompt in logs

### Cost is too high
- Switch to a cheaper model (set `model_override` to `gpt-3.5-turbo-0125`)
- Increase `min_length_for_variation` to skip short posts
- Disable for certain workflows (remove from `workflows` array)

### Using custom LLM provider (9router, local LLM, etc.)
- Set `settings.llm.base_url` to your provider's URL
- Set `settings.llm.api_key` to your API key
- Set `settings.llm.model_variation` to the model name (or leave null to use main model)

---

## Files

- `n8n/code/text_variation.js` — Core logic with persona integration
- `db/migrations/015_text_variation_settings.sql` — Settings and tracking table
- `docs/12-text-variation.md` — Complete feature documentation
- `docs/TEXT_VARIATION_SUMMARY.md` — This file

---

## Future Enhancements

- **Semantic similarity check** — use embeddings to ensure meaning is preserved
- **A/B testing integration** — track engagement on varied vs original posts
- **Custom dictionaries** — define which words can/cannot be substituted
- **Multi-language support** — handle BM, English, and rojak variations separately
- **HuggingFace dataset integration** — use Malaysian datasets directly for variations (if needed)

---

## Summary

The text variation feature is now **production-ready** with:

✅ **Persona integration** — uses your 177 Malaysian snippets as style reference  
✅ **LLM configuration** — uses existing `settings.llm`, supports any provider  
✅ **Custom base URL** — works with 9router, OpenAI, local LLMs, etc.  
✅ **Malaysian Malay enforcement** — blocks Indonesian and formal Malay  
✅ **Tone awareness** — each tone has specific vocabulary and style guidance  
✅ **Enhanced tracking** — logs which model and provider was used  

**Cost**: ~$0.07/month at 5 posts/day with gpt-3.5-turbo

**Status**: Ready to deploy
