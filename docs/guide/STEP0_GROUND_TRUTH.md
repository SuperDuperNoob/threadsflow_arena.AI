# Step 0 Ground-Truth Table (Settings Keys Actually Live)

Generated 2026-08-01 by tracing every `settings` read in n8n/code/*.js and workflows.

| key       | is truly dynamic (yes/no) | consuming files (recurring path)                  | fields + constraints found in code |
|-----------|---------------------------|---------------------------------------------------|------------------------------------|
| llm       | yes                       | text_variation.js, lib/llm.js (getLlmConfig)      | base_url (url), model_*, api_key (masked) |
| posting   | yes                       | slot_plan.js, bandit.js, persona_slot_plan.js     | timezone(str), slot_hours(array), skip_probability(0-1), jitter_minutes(int), carousel_probability(0-1), reply_delay_range_sec([int,int]), posts_per_day(int) |
| bandit    | yes                       | bandit.js, scoring.js, persona_topic_pick.js      | epsilon(0-1), decay(0-1), loser_cooldown_days(>=1), loser_bottom_pct(0-1), winner_top_pct(0-1), money_shrinkage_target_orders(>0), bayesian_prior_clicks(>0) |
| qa        | yes                       | qa.js, l4_qa_reply.js, qa_persona.js              | max_similarity(0-1), max_reply_length(>0) |
| l4_reply  | yes                       | l4_reply_plan.js                                  | max_replies_per_day(>0), max_replies_per_post(>0), cooldown_hours_per_user(>=0), post_age_days(>=0), min_comment_length(>=0) |
| warmup    | yes                       | persona_slot_plan.js                              | persona_slot_hours(array), persona_skip_prob(0-1), persona_jitter_min(int), persona_micro_pct/mid_pct(0-1), persona_follow_request(obj) |
| scoring   | yes (sub-object)          | scoring.js                                        | bayesian_prior_clicks(>0), money_shrinkage_target_orders(>0), winner_top_pct/loser_bottom_pct(0-1) |
| threads_creds | no (secret)            | wf0, wf3 (token only)                             | NEVER expose via generic route |
| others    | no                        | only in seeds/migration or one-off                | excluded |

Notes:
- All "yes" keys are re-read on every workflow execution (n8n Code nodes receive $json.settings).
- llm has explicit hot-reload (clearLlmConfigCache).
- No key is purely startup-only; all are dynamic.
- threads_creds and any key containing tokens are excluded from allowlist.