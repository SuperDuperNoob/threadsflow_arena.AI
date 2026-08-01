# Loop L4 — On-Post Reply Engagement

> **Pivot from Karma (`wf6_karma`):** External thread search and unsolicited commenting are not supported by the official Threads API and carry a high account-risk profile. L4 focuses only on replies to comments on your own published posts.

## Purpose

Build real account engagement and algorithm reach by responding to real user comments on your published Threads posts in everyday Malaysian Malay.

## Current workflow behavior

`n8n/workflows/wf7_l4_reply.json` currently does this every 4 hours:

1. Loads `settings.l4_reply`.
2. Stops if `settings.l4_reply.enabled` is false.
3. Reads comments from the local `threads_comments` table, not directly from the Threads API.
4. Plans candidate replies with `n8n/code/l4_reply_plan.js`.
5. Classifies intent with `n8n/code/l4_classify_intent.js`.
6. Builds a reply prompt with `n8n/code/l4_draft_reply.js` and calls the configured LLM.
7. Runs `n8n/code/l4_qa_reply.js`.
8. Publishes a reply with `POST https://graph.threads.net/v1.0/{comment_id}/replies`.
9. Inserts/updates `l4_replies` for published or QA-rejected replies.

## Required upstream data

L4 requires `threads_comments` rows. Migration 013 creates that table, but the current `wf7_l4_reply.json` does not itself call `GET /v1.0/{media_id}/replies` to populate it. Any live deployment must ensure comments are ingested into `threads_comments` before L4 can find candidates.

## Token caveat

`wf7_l4_reply.json` reads the publish token from:

```text
settings.l4_reply.threads_token
```

`scripts/set_secrets.sh` writes the L4 copy directly to `settings.l4_reply.threads_token`
(`scripts/set_secrets.sh:135-141`), matching this read — no manual reconciliation needed.

## Safety & rate limits

Defaults from `settings.l4_reply`:

- max 10 replies/day
- max 5 replies/post
- 24h cooldown per user
- only posts from the last 7 days
- min comment length 3
- max reply length 180

The `human_approval_required` setting exists in JSON, but there is no current L4 approval UI; the workflow publishes after QA.

## Official references

- Reading replies on a post (`GET /v1.0/{media_id}/replies`): https://developers.facebook.com/docs/threads/reply-control
- Posting a reply (`POST /v1.0/{comment_id}/replies` / `reply_to_id`): https://developers.facebook.com/docs/threads/reply-control
- Posts overview and character limits: https://developers.facebook.com/docs/threads/posts
- Rate limiting: https://developers.facebook.com/docs/threads/overview
