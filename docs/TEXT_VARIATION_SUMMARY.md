# Text Variation Audit Summary

This summary supersedes the earlier implementation-claim document. It is grounded in the current repository state.

## Verdict

`text_variation` is **not active in the shipped n8n workflows**.

The repository contains:

| Artifact | Status |
|---|---|
| `db/migrations/015_text_variation_settings.sql` | Creates `settings.text_variation` and `text_variations`. |
| `n8n/code/text_variation.js` | Reusable Code-node helper for prompt building and validation. |
| `n8n/workflows/wf2_generate.json` | No text-variation node present. |
| `n8n/workflows/wf3_publish.json` | No text-variation node present. |
| `n8n/workflows/wf6_persona.json` | No text-variation node present. |

Therefore, documentation must not state that every post currently goes through an LLM variation pass before publishing.

## What remains true

- Migration 015 seeds a configuration row with preservation settings for hashtags, mentions, links, and emoji.
- The helper can select persona snippets and build Malaysian Malay variation prompts.
- The helper exports `validateVariation()` for a future validation node.
- The helper uses the repository convention of LLM settings being supplied from `settings.llm` / workflow context.

## What was not verifiable

- Automatic application to `wf6_persona` or `wf3_publish`.
- Automatic logging into `text_variations` from current workflows.
- A current workflow route that calls a variation LLM and swaps `varied_text` into the post body.

## Future activation checklist

1. Add a Code node using `n8n/code/text_variation.js` after the QA pass.
2. Add an HTTP Request node for the variation LLM call.
3. Add a validation Code node using `validateVariation()`.
4. Add a Postgres logging node for `text_variations`.
5. Use the validated `varied_text` for downstream publishing/insertion.
6. Run `node scripts/populate_workflows.js` and `./scripts/bootstrap_n8n.sh`.

## Related documentation

- `docs/12-text-variation.md` — operator-facing status and future wiring notes.
