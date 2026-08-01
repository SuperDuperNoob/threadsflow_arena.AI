# wf6_persona & L4 Reply Loop — Current Status Audit

This file was refreshed after auditing the live schema, workflow JSON, and code nodes.

## What is implemented

### Migration 011

`db/migrations/011_persona_l4_improvements.sql` adds:

- `persona_topics.time_of_day TEXT[]`
- `posts.psychology_techniques TEXT[]`
- `l4_replies` for reply audit/rate limiting
- `persona_topic_feedback` as a table for future wf4 → wf6 topic feedback
- `settings.l4_reply`

Current default for `settings.l4_reply` in the migration is:

```json
{
  "enabled": true,
  "max_replies_per_day": 10,
  "max_replies_per_post": 5,
  "cooldown_hours_per_user": 24,
  "post_age_days": 7,
  "min_comment_length": 3,
  "max_reply_length": 180,
  "human_approval_required": false,
  "persona_calibration_enabled": true,
  "psychology_techniques_enabled": true,
  "intent_classification": {
    "enabled": true,
    "model_override": null
  },
  "schedule_interval_hours": 4,
  "timezone": "Asia/Kuala_Lumpur"
}
```

### wf6_persona

`n8n/workflows/wf6_persona.json` is present and importable. It:

1. Loads `settings.llm`, `settings.qa`, `settings.warmup`, and `settings.bandit`.
2. Builds persona slots at 03:30.
3. Assigns time-of-day and psychology-technique metadata in `n8n/code/persona_slot_plan.js`.
4. Picks a persona topic.
5. Builds prompts.
6. Calls the writer/editor/embedding LLM endpoints.
7. Runs `n8n/code/qa_persona.js`.
8. Queues persona posts and increments `persona_topics.times_picked`.

Persona posts remain `media_type='TEXT'`, `sell_intensity=0`, and `purpose='persona'`.

### wf7_l4_reply

`n8n/workflows/wf7_l4_reply.json` is present and imported by `scripts/bootstrap_n8n.sh`. It:

1. Loads `settings.l4_reply`.
2. Skips the workflow if L4 is disabled.
3. Fetches posts with comments and unreplied comments.
4. Plans replies with `n8n/code/l4_reply_plan.js`.
5. Classifies intent with `n8n/code/l4_classify_intent.js`.
6. Drafts and QA-checks replies.
7. Publishes replies to Threads.
8. Writes `l4_replies` rows for published and QA-rejected replies.

## Important current mismatches

### 1. L4 token storage mismatch

`wf7_l4_reply.json` publishes replies with:

```text
$('Load L4 config').first().json.value?.threads_token
```

That means it expects the token inside `settings.l4_reply.threads_token`.

However, `scripts/set_secrets.sh` currently writes the L4 copy to `settings.l4_config.threads_token`, while `wf7_l4_reply` loads `settings.l4_reply`. Until code is reconciled, operators must either:

```sql
UPDATE settings
SET value = value || jsonb_build_object('threads_token', 'YOUR_LONG_TOKEN')
WHERE key = 'l4_reply';
```

or change the workflow/script to use the same key.

### 2. `persona_topic_feedback` is schema groundwork

The table exists, but the current `wf4_evaluate.json` does not insert feedback rows into
`persona_topic_feedback`, and `wf6_persona.json` currently rotates topics by incrementing
`persona_topics.times_picked`. Topic-level Thompson updates remain future work.

### 3. L4 human approval flag is not wired to a UI

`settings.l4_reply.human_approval_required` exists in the JSON defaults, but the current workflow
publishes replies directly after QA. There is no separate L4 reply approval queue in the KB UI.

## Deployment notes

Use the bootstrap script instead of manual workflow import:

```bash
./scripts/bootstrap_n8n.sh
```

Activate only after Threads credentials are in place:

```bash
./scripts/bootstrap_n8n.sh --activate
cd infra && docker compose restart n8n
```

Before relying on L4 replies, confirm:

```sql
SELECT key, value ? 'threads_token' AS has_threads_token
FROM settings
WHERE key='l4_reply';
```

## Code references

- `db/migrations/011_persona_l4_improvements.sql` — schema and L4 defaults.
- `n8n/workflows/wf6_persona.json` — active persona workflow.
- `n8n/workflows/wf7_l4_reply.json` — active L4 reply workflow.
- `n8n/code/persona_slot_plan.js`, `persona_topic_pick.js`, `qa_persona.js` — persona logic.
- `n8n/code/l4_reply_plan.js`, `l4_classify_intent.js`, `l4_draft_reply.js`, `l4_qa_reply.js` — L4 logic.
- `scripts/bootstrap_n8n.sh` — imports and optionally activates wf0/wf6/wf3/wf7.
- `scripts/set_secrets.sh` — writes `threads_creds` and currently writes L4 token to `l4_config`.
