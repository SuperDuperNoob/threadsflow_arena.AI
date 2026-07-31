# Persona warm-up layer (wf6_persona)

> Solves the cold-start problem: a brand-new Threads account posting 100% affiliate links
> gets throttled by the algorithm and flagged by humans. For the first 2–4 weeks the account
> needs to look like a real person before the product posts land.

## What it does

wf6_persona is a second nightly workflow (runs at **03:30**, after wf2 finishes at 03:00) that
generates **no-link, no-product, no-CTA** persona posts from a `persona_topics` pool.

- Persona posts are always TEXT, `sell_intensity=0`, `purpose='persona'`.
- They use the same LLM endpoints, same persona-snippet dataset, and same embedding
  anti-repetition check as product posts.
- They use a **persona-specific writer prompt** (`prompts/persona_writer.md`) and a
  **persona-specific QA gate** (`n8n/code/qa_persona.js`) that enforces: no promo language,
  no Shopee/Lazada/link/CTA words, no broadcast openers, no Indonesian words, at least one
  concrete anchor (time/place/sensation/object/person/number) so the post is not generic.
- They skip the CTA-comment step in wf3 (which already has a "CTA skipped (sell_intensity=0)"
  branch).

## Topic pool (bandit over topics)

Persona topics live in `persona_topics`. Each has Beta(alpha,beta) stats so the system
Thompson-samples which topics to post about, exactly the same way wf2 picks levers.
Cooldown, pinned-topic priority, and a 7-day recent-use filter prevent repetition.

Three sources of topics:

1. **Starter seed (30 topics)** shipped in migration 010: Malaysian household petua,
   everyday frustrations, mamak/teh tarik, hujan, WFH, Waze sesat, small-money observations,
   soalan-soalan. These are enough for the first 1–2 weeks without any API key.
2. **Perplexity Sonar weekly refresh (optional):** when `PERPLEXITY_API_KEY` is set, running
   `./scripts/refresh_persona_topics.sh` (or the future wf7 weekly cron) calls Perplexity's
   web-search-enabled chat completion with `search_recency_filter=week` and injects
   8 fresh, timely, Malaysian-context topics.
3. **Manual pinning via SQL:**
   ```sql
   INSERT INTO persona_topics (source_id, topic, angle_hint, niche_tags, pinned)
   VALUES ((SELECT id FROM persona_topic_sources WHERE slug='manual'),
           'Topik yang saya nak post hari ini', 'luahan', ARRAY['everyday'], true);
   ```

## Warm-up schedule (phases)

The phase is controlled by `settings.warmup`, seeded by migration 010:

| Phase | Persona posts/day | Product posts/day | Duration |
|---|---|---|---|
| **warmup** | 4 | 0 | 14 days |
| **ramp** | 4 | 1 | 16 days |
| **steady** | 3 | 2 | ongoing |

Slot hours default to `[7, 11, 16, 21]` (Asia/Kuala_Lumpur), jittered ±22 min, with 8% skip
probability for irregularity. Length mix: 25% micro, 60% mid, 15% long. Tone is drawn from a
persona-appropriate subset (`deadpan, gaul, warm_sibling, chaotic, minimal`) — no
`corporate_parody` or `enthusiast` (those read too much like an account/brand).

To mark the start of warm-up (resets `started_at` so phases are measured from when you go
live), run:

```sql
UPDATE settings
SET value = jsonb_set(value, '{started_at}', to_jsonb(now()::text))
WHERE key = 'warmup';
```

Until you set `started_at`, the warmup config stays at its defaults and wf6 posts 4 persona
slots per day with zero product slots. That is exactly what you want for the first fortnight.

## Importing and activating wf6

1. Run the database migration (automatic via `./scripts/init_db.sh`):
   ```bash
   ./scripts/init_db.sh     # or run migration 010 against a running DB
   ```
   This creates `persona_topics`, `persona_topic_sources`, adds `posts.purpose` /
   `persona_topic_id` / `topic_context`, inserts 30 starter topics and the persona-specific
   banned openers, and writes the default `settings.warmup`.

2. In n8n:
   - Import `n8n/workflows/wf6_persona.json` (like you did for wf0/wf2/wf3/wf4).
   - For every **Postgres** node, set credential to `Postgres threadsflow`.
   - Leave it **deactivated** until you are ready to start warm-up.

3. (Optional) Add your Perplexity key to `infra/.env` to enable weekly topic refresh:
   ```
   PERPLEXITY_API_KEY=pplx-...
   PERPLEXITY_MODEL=sonar
   ```
   Then `cd infra && docker compose up -d` and run `./scripts/refresh_persona_topics.sh`
   to populate fresh topics. Without a key, the 30 starter topics are plenty.

4. Activate wf6 first (for days 1–14), activate wf3_publish at the same time (so the queued
   persona posts actually go out), **do not activate wf2_generate yet** — it has nothing to
   post until you add products and warmup phase reaches "ramp". After 14 days, activate wf2
   and adjust `settings.warmup.phases` if you want a different ratio.

## How this interacts with other workflows

- **wf3_publish** — already handles persona posts correctly: it reads `media_type=TEXT` and
  `sell_intensity=0`, publishes the text post, and skips the CTA reply because the
  "Needs link comment?" IF node routes `0` to the "skip CTA" branch.
- **wf4_evaluate** — scores all published posts including persona posts. Persona posts score
  on pure engagement (replies, reposts, quotes, likes, views), not money. A future extension
  will add topic-level Thompson updates to `persona_topics.alpha/beta` the same way arm_stats
  are updated for levers; for the first launch, topic-level stats use the simpler
  `times_picked` counter.
- **L4 reply loop** (docs/07-l4-reply-loop.md) — should be activated after the first few
  persona posts are live, so it replies to people who comment on them. Use the "persona"
  reply prompt (conversational, no product mention), not the "product" reply prompt.

## Files added / changed

| File | What it is |
|---|---|
| `db/migrations/010_persona_warmup.sql` | Schema + 30 starter topics + banned openers + `settings.warmup` defaults |
| `n8n/code/persona_slot_plan.js` | Slot planner for persona posts (4 daily slots, jitter, length mix, tone whitelist) |
| `n8n/code/persona_topic_pick.js` | Thompson-sampled topic picker with cooldown and pinned priority |
| `n8n/code/qa_persona.js` | Persona-specific QA gate (no promo, anchor required, Indonesian/shouting/broadcast bans) |
| `prompts/persona_writer.md` | Writer prompt template (no-link, no-selling, grounded in small moments) |
| `n8n/workflows/wf6_persona.json` | Importable n8n workflow (generated by `scripts/build_wf6.mjs`) |
| `scripts/build_wf6.mjs` | Generator for `wf6_persona.json` (re-run if you change the workflow shape or prompts) |
| `scripts/refresh_persona_topics.sh` | Wrapper that exec's into `kb` to run `bin/topic_refresh.mjs` |
| `services/kb/bin/topic_refresh.mjs` | Calls Perplexity Sonar, validates, dedupes, inserts into `persona_topics` |
| `services/kb/lib/llm.js` | Added `completePerplexity()` and override-able `base_url/api_key/max_tokens` on `complete()` |

## Official references

- Perplexity API docs (Sonar web search, OpenAI-compatible chat completions): https://docs.perplexity.ai/api-reference/chat-completions
- Perplexity Sonar `search_recency_filter` option: https://docs.perplexity.ai/guides/search-filters
- Thompson sampling for cold-start content selection: https://lilianweng.github.io/posts/2018-01-23-multi-armed-bandit/
