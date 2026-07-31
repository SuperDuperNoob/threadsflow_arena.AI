# Text Variation Feature

**Applies subtle LLM-based variations to posts before publishing to ensure no two posts are identical.**

**NOW WITH:**
- ✅ Integration with `settings.llm` (custom base URL, API key, model)
- ✅ Persona snippet integration for authentic Malaysian variations
- ✅ Malaysian Malay language preservation
- ✅ Tone/persona awareness

---

## What it does

Every post goes through a lightweight LLM pass that makes 1-3 small changes (word substitutions, phrase rewording) while preserving:
- **Meaning** — the message stays the same
- **Tone** — gaul stays gaul, deadpan stays deadpan
- **Malaysian Malay** — uses BM pasar, rojak, avoids Indonesian/formal Malay
- **Structure** — hashtags, mentions, links, and emoji are untouched
- **Length** — variations stay within ±10% of original length

### Examples (Malaysian Malay)

| Original | Variation 1 | Variation 2 | Variation 3 |
|---|---|---|---|
| Memang best gila | Memang best sangat | Memang super best | Best gila lah |
| Dah cuba belum? | Dah try belum? | Pernah cuba? | Dah rasa belum? |
| Harga RM50 je | RM50 sahaja | Cuma RM50 | RM50 je weh |
| Korang kena try | Korang patut cuba | Kena try ni | Cuba lah korang |

---

## Why use it?

1. **Avoid duplicate detection** — Threads/Instagram algorithms flag identical posts
2. **Sound more human** — real people don't repeat exact phrases
3. **Reduce pattern detection** — harder to identify as automated
4. **Natural A/B testing** — subtle variations to see what resonates
5. **Unique content** — even if you post the same topic twice, it won't look repetitive
6. **Authentic Malaysian voice** — uses persona snippets as reference for natural BM

---

## How it works

### 1. Post generation
The normal workflow generates a post (persona or product).

### 2. Text variation (NEW)
Before publishing, the post is sent to `text_variation.js` which:
- Checks if the post is long enough (>50 chars)
- **Selects 2-3 persona snippets that match the tone** (gaul → casual snippets, deadpan → neutral snippets)
- **Builds a prompt with Malaysian Malay enforcement** (no Indonesian, no formal BM)
- Sends to your configured LLM (from `settings.llm`)
- Validates the variation (preserves hashtags, mentions, links, emoji)
- Returns the varied text

### 3. Publishing
The varied text is published instead of the original.

### 4. Logging
Every variation is logged in `text_variations` table with:
- Original text
- Varied text
- LLM model used
- LLM base URL used
- Validation status

---

## Configuration

### LLM Configuration (uses existing `settings.llm`)

The text variation feature uses your existing LLM configuration:

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

**Priority order:**
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

### Settings explained

- **enabled** — turn variation on/off globally
- **max_changes** — max number of word/phrase substitutions (1-3 recommended)
- **preserve_hashtags** — don't change `#hashtags`
- **preserve_mentions** — don't change `@mentions`
- **preserve_links** — don't change `https://...` URLs
- **preserve_emoji** — don't change emoji
- **min_length_for_variation** — only vary posts longer than this (short posts stay as-is)
- **temperature** — LLM temperature (0.4 = balanced creativity/consistency)
- **max_tokens** — max response length
- **model_override** — override the LLM model for variations only (null = use settings.llm)
- **workflows** — which workflows apply variation (wf6_persona, wf3_publish)

---

## Malaysian Malay Language Enforcement

The system enforces authentic Malaysian Malay:

### ✅ ALLOWED (Malaysian BM)
- Contractions: `tak`, `nak`, `dah`, `je`, `lah`, `kan`, `kot`, `memang`, `boleh`
- Rojak (mixed English): `"memang best"`, `"sangat nice"`, `"boleh try"`
- Malaysian slang: `weh`, `gila`, `power`, `best`, `cun`
- Currency: `RM` (ringgit)

### ❌ BLOCKED
- **Indonesian words**: `banget`, `nggak`, `gak`, `aja`, `udah`, `bikin`, `gimana`, `kalian`, `doang`, `cowok`, `cewek`, `gue`, `deh`, `dong`, `sih`
- **Formal Malay**: `tidak`, `hendak`, `sudah`, `sahaja`, `bolehkah`, `di mana`
- **Indonesian currency**: `Rp`, `rupiah`

### False Friends Protection
- `bisa` = venom in Malay (use `boleh`)
- `butuh` = vulgar in Malay (use `perlu`)
- `pusing` = to turn in Malay (use `pening` for dizzy)

---

## Persona Snippet Integration

The system uses your 177 Malaysian persona snippets as reference:

1. **Tone matching** — selects snippets that match the post's tone (gaul → casual snippets, deadpan → neutral snippets)
2. **Style reference** — LLM borrows rhythm, vocabulary patterns, and sentence structure from snippets
3. **No copying** — LLM is instructed to borrow style, not copy exact phrases

### Example
If the post is in `gaul` tone, the system might select these snippets as reference:
- `"Semalam lepak mamak sampai pukul 2 pagi. Borak kosong je, tapi best gila."`
- `"Pergi Midvalley semalam, ingat nak window shopping je. Last-last terbeli kasut RM200."`

The LLM then applies similar casual, rojak style to the variation.

---

## Cost

**Very low.** Each variation costs ~$0.0005 with gpt-3.5-turbo.

At 5 posts/day = 35 posts/week = $0.0175/week = **$0.07/month**.

**Using 9router or other providers?** Cost depends on your provider's pricing.

---

## Validation

The system validates every variation to ensure:

1. **Length check** — variation is within ±10% of original length
2. **Hashtag preservation** — all `#hashtags` are unchanged
3. **Mention preservation** — all `@mentions` are unchanged
4. **Link preservation** — all URLs are unchanged
5. **Not identical** — variation actually changed something
6. **Language check** — no Indonesian words, no formal Malay

If validation fails, the original text is used (no variation applied).

---

## Integration

### Workflow integration

To add variation to a workflow:

1. **After QA pass, before publishing:**
   ```
   [QA pass] → [Text variation] → [LLM: apply variation] → [Validate] → [Publish]
   ```

2. **Text variation node** (`n8n/code/text_variation.js`):
   - Input: `text`, `tone`, `persona_snippets`, `settings.llm`, `settings.variation`
   - Output: `system_prompt`, `user_prompt`, `llm_config` (for LLM call)

3. **LLM call** (HTTP request):
   - Uses `system_prompt` and `user_prompt` from variation node
   - Uses `llm_config.base_url`, `llm_config.api_key`, `llm_config.model`
   - Temperature: 0.4 (or configured)

4. **Validation node** (Code node):
   - Calls `validateVariation(original, varied, settings)`
   - Checks for Indonesian words, formal Malay
   - If valid, use `varied_text`
   - If invalid, use `original_text`

5. **Log variation** (Postgres):
   ```sql
   INSERT INTO text_variations (workflow, post_id, original_text, varied_text, changes_made, validation_passed, llm_model_used, llm_base_url_used)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
   ```

---

## Monitoring

### Check variations in database

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

-- Average changes per variation
SELECT AVG(changes_made) AS avg_changes
FROM text_variations
WHERE created_at > NOW() - INTERVAL '7 days' AND validation_passed;

-- Which LLM models are being used
SELECT llm_model_used, COUNT(*) as count
FROM text_variations
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY llm_model_used;
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

- `n8n/code/text_variation.js` — variation logic with persona integration
- `db/migrations/015_text_variation_settings.sql` — settings and tracking table
- `docs/12-text-variation.md` — this file

---

## Future enhancements

- **Semantic similarity check** — use embeddings to ensure meaning is preserved
- **A/B testing integration** — track engagement on varied vs original posts
- **Custom dictionaries** — define which words can/cannot be substituted
- **Multi-language support** — handle BM, English, and rojak variations separately
- **HuggingFace dataset integration** — use Malaysian datasets directly for variations (if needed)

---

**Added in migration 015.** Enabled by default for `wf6_persona` and `wf3_publish` workflows.

**Uses your existing LLM configuration** (`settings.llm`) — no separate API keys needed.

**Integrates with persona snippets** — uses your 177 Malaysian snippets as style reference.
