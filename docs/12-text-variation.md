# Text Variation Status

This file was audited against the current codebase.

## Current status

Text variation is **schema + library groundwork, not an active production workflow step**.

What exists:

- `db/migrations/015_text_variation_settings.sql` seeds `settings.text_variation` and creates the `text_variations` audit table.
- `n8n/code/text_variation.js` can build prompts, choose persona snippets, and validate a varied text candidate.
- The library expects existing LLM configuration from `settings.llm` / environment-derived LLM settings.

What is **not** wired today:

- `n8n/workflows/wf2_generate.json`, `wf3_publish.json`, and `wf6_persona.json` do not contain a Text Variation node, LLM variation HTTP node, validation node, or `INSERT INTO text_variations` logging node.
- Therefore no active workflow currently sends every post through `text_variation.js` before publishing.
- Claims that the feature is automatically enabled for `wf6_persona` or `wf3_publish` are not supported by the current workflow JSONs.

## Settings row seeded by migration 015

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

This row is configuration data only until a workflow actually reads it.

## Library behavior if wired into a workflow

`n8n/code/text_variation.js`:

1. Checks `settings.variation.enabled` and `min_length_for_variation`.
2. Selects persona snippets matching the tone.
3. Builds a Malaysian Malay variation prompt.
4. Returns `system_prompt`, `user_prompt`, and `llm_config` for a following LLM HTTP node.
5. Exports `validateVariation(original, varied, settings)` to reject changed hashtags, mentions, links, or large length drift.

Important: the code node does **not** call the LLM itself. A workflow must add the LLM HTTP request and pass the response into validation/logging.

## To activate in the future

Add the following nodes to the target workflow after QA and before publish/insert:

```text
[QA pass]
  → [Code: Text variation prompt from n8n/code/text_variation.js]
  → [HTTP: LLM variation call]
  → [Code: validateVariation(original, varied, settings)]
  → [Postgres: INSERT text_variations]
  → [Use varied_text if valid, original otherwise]
```

Then re-run:

```bash
node scripts/populate_workflows.js
./scripts/bootstrap_n8n.sh
```

## Monitoring once wired

```sql
SELECT workflow, original_text, varied_text, changes_made, llm_model_used, created_at
FROM text_variations
ORDER BY created_at DESC
LIMIT 10;
```

## Code references

- `db/migrations/015_text_variation_settings.sql` — settings row and `text_variations` table.
- `n8n/code/text_variation.js` — prompt/validation helper.
- `n8n/workflows/*.json` — audited and currently no active Text Variation node is present.
