# Text Variation Feature

**Applies subtle LLM-based variations to posts before publishing to ensure no two posts are identical.**

---

## What it does

Every post goes through a lightweight LLM pass that makes 1-3 small changes (word substitutions, phrase rewording) while preserving:
- **Meaning** — the message stays the same
- **Tone** — casual stays casual, formal stays formal
- **Structure** — hashtags, mentions, links, and emoji are untouched
- **Length** — variations stay within ±10% of original length

### Examples

| Original | Variation 1 | Variation 2 | Variation 3 |
|---|---|---|---|
| Hello world | Hi world | Hey world | Hello there |
| This is amazing | This is incredible | This is awesome | This is fantastic |
| Check this out | Take a look at this | Have a look at this | You should see this |
| I love this product | I really love this product | I'm loving this product | I absolutely love this product |

---

## Why use it?

1. **Avoid duplicate detection** — Threads/Instagram algorithms flag identical posts
2. **Sound more human** — real people don't repeat exact phrases
3. **Reduce pattern detection** — harder to identify as automated
4. **Natural A/B testing** — subtle variations to see what resonates
5. **Unique content** — even if you post the same topic twice, it won't look repetitive

---

## How it works

### 1. Post generation
The normal workflow generates a post (persona or product).

### 2. Text variation (NEW)
Before publishing, the post is sent to `text_variation.js` which:
- Checks if the post is long enough (>50 chars)
- Builds a prompt asking the LLM to make 1-3 subtle changes
- Sends to a cheap/fast model (gpt-3.5-turbo)
- Validates the variation (preserves hashtags, mentions, links, emoji)
- Returns the varied text

### 3. Publishing
The varied text is published instead of the original.

### 4. Logging
Every variation is logged in `text_variations` table for debugging and analysis.

---

## Configuration

Settings are stored in `settings.text_variation`:

```json
{
  "enabled": true,
  "max_changes": 3,
  "preserve_hashtags": true,
  "preserve_mentions": true,
  "preserve_links": true,
  "preserve_emoji": true,
  "min_length_for_variation": 50,
  "temperature": 0.3,
  "model": "gpt-3.5-turbo",
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
- **temperature** — LLM temperature (0.3 = controlled, 0.7 = more creative)
- **model** — which LLM to use (gpt-3.5-turbo is cheap and fast)
- **workflows** — which workflows apply variation (wf6_persona, wf3_publish)

---

## Cost

**Very low.** Each variation costs ~$0.0005 with gpt-3.5-turbo.

At 5 posts/day = 35 posts/week = $0.0175/week = **$0.07/month**.

---

## Validation

The system validates every variation to ensure:

1. **Length check** — variation is within ±10% of original length
2. **Hashtag preservation** — all `#hashtags` are unchanged
3. **Mention preservation** — all `@mentions` are unchanged
4. **Link preservation** — all URLs are unchanged
5. **Not identical** — variation actually changed something

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
   - Input: `text`, `tone`, `settings.variation`
   - Output: `system_prompt`, `user_prompt`, `settings` (for LLM call)

3. **LLM call** (HTTP request):
   - Uses `system_prompt` and `user_prompt` from variation node
   - Model: `gpt-3.5-turbo` (or configured model)
   - Temperature: 0.3 (or configured)

4. **Validation node** (Code node):
   - Calls `validateVariation(original, varied, settings)`
   - If valid, use `varied_text`
   - If invalid, use `original_text`

5. **Log variation** (Postgres):
   ```sql
   INSERT INTO text_variations (workflow, post_id, original_text, varied_text, changes_made, validation_passed)
   VALUES ($1, $2, $3, $4, $5, $6);
   ```

---

## Monitoring

### Check variations in database

```sql
-- Recent variations
SELECT workflow, original_text, varied_text, changes_made, created_at
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
- Check LLM API key is valid

### Cost is too high
- Switch to a cheaper model (e.g., `gpt-3.5-turbo-0125`)
- Increase `min_length_for_variation` to skip short posts
- Disable for certain workflows (remove from `workflows` array)

---

## Files

- `n8n/code/text_variation.js` — variation logic
- `db/migrations/015_text_variation_settings.sql` — settings and tracking table
- `docs/12-text-variation.md` — this file

---

## Future enhancements

- **Semantic similarity check** — use embeddings to ensure meaning is preserved
- **A/B testing integration** — track engagement on varied vs original posts
- **Custom dictionaries** — define which words can/cannot be substituted
- **Multi-language support** — handle BM, English, and rojak variations separately

---

**Added in migration 015.** Enabled by default for `wf6_persona` and `wf3_publish` workflows.
