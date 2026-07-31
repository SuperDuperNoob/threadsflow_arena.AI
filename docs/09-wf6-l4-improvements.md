# wf6_persona & L4 Reply Loop Improvements (2026-07-31)

This document summarizes the improvements made to the persona warm-up workflow (wf6_persona) and the L4 reply loop based on the psychology & communication theory techniques from the newly audited books.

---

## Overview

### What was added
- **Migration 011** — Schema additions for time-of-day topic affinity, psychology technique tracking, L4 reply tracking, and persona topic feedback loop
- **Psychology technique integration** — 17 techniques from Cialdini, Voss, Dhawan, Handley, Carnegie, Bacon wired into wf6_persona and L4
- **Time-of-day awareness** — Persona topics tagged with preferred times (morning/midday/afternoon/evening)
- **L4 reply loop code nodes** — Intent classification, psychology-aware reply drafting, QA gate
- **Enhanced prompts** — persona_writer.md and reply_assistant.md now include psychology technique guides

### Files created/modified

**New files:**
- `db/migrations/011_persona_l4_improvements.sql` — Schema additions
- `n8n/code/l4_reply_plan.js` — L4 step 0: pick posts with unreplied comments
- `n8n/code/l4_classify_intent.js` — L4 step 1: classify comment intent
- `n8n/code/l4_qa_reply.js` — L4 step 3: QA gate for drafted replies
- `n8n/code/l4_draft_reply.js` — L4 step 2: draft reply with psychology techniques

**Modified files:**
- `n8n/code/persona_slot_plan.js` — Added time_of_day and psychology_techniques to slots
- `n8n/code/persona_topic_pick.js` — Added time-of-day affinity to topic picker
- `n8n/code/qa_persona.js` — Added psychology technique validation
- `prompts/persona_writer.md` — Added psychology technique guide section
- `prompts/reply_assistant.md` — Fixed merge conflict, added psychology techniques

---

## Migration 011: Schema Additions

### New columns
- `persona_topics.time_of_day` TEXT[] — Preferred times for topic (morning/midday/afternoon/evening)
- `posts.psychology_techniques` TEXT[] — Which psychology techniques were applied to a post

### New tables
- `l4_replies` — Track L4 reply actions (audit, cooldown, rate limiting)
  - Columns: id, uid, post_id, comment_id, comment_text, intent, reply_text, reply_comment_id, psychology_techniques, status, qa_reasons, persona_calibrated, created_at, published_at
  - Indexes: post_id, status, published_at (for rate limiting queries)

- `persona_topic_feedback` — wf4→wf6 feedback for topic bandit updates
  - Columns: id, persona_topic_id, post_id, engagement_score, reward, metrics, created_at
  - Purpose: When wf4 scores a persona post, it writes feedback here. wf6 reads these to update persona_topics.alpha/beta via Thompson sampling.

### Time-of-day tags on starter topics
Migration 011 tags the 30 existing starter topics with time_of_day preferences:
- **Morning (7am slot)**: commute, breakfast, work-start topics
- **Midday (11am slot)**: work, lunch, office topics
- **Afternoon (4pm slot)**: petua, household, shopping topics
- **Evening (9pm slot)**: food, weather, family, reflection topics

Topics without a time_of_day tag work at any time.

### L4 reply settings
New `settings.l4_reply` row with defaults:
```json
{
  "enabled": false,
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

---

## wf6_persona Improvements

### 1. Psychology technique assignment (persona_slot_plan.js)

**What changed:**
- Each slot now gets 1-2 psychology techniques from the persona-appropriate pool
- Techniques are weighted by time of day (e.g., `belonging_signal` gets 1.4x weight in evening slots)
- 30% chance of 2 techniques per slot, 70% chance of 1

**Technique pool:**
```javascript
[
  'reciprocity_first',        // give value before asking
  'liking_through_specificity', // name one specific shared detail
  'unity_shared_identity',    // name the group the reader belongs to
  'punctuation_signals_tone', // period = serious, no period = casual
  'clarity_over_cleverness',  // one idea per sentence
  'write_like_you_talk',      // BM pasar contractions
  'cut_ruthlessly',           // every sentence must earn its place
  'participation_loop',       // ask for specific input
  'belonging_signal',         // "kita" for struggles, "saya" for wins
]
```

**Time-of-day weights:**
```javascript
{
  morning:   { reciprocity_first: 1.2, belonging_signal: 1.0, participation_loop: 0.8 },
  midday:    { clarity_over_cleverness: 1.3, write_like_you_talk: 1.2, cut_ruthlessly: 1.1 },
  afternoon: { reciprocity_first: 1.3, liking_through_specificity: 1.2, participation_loop: 1.1 },
  evening:   { belonging_signal: 1.4, unity_shared_identity: 1.3, participation_loop: 1.2 },
}
```

### 2. Time-of-day topic affinity (persona_topic_pick.js)

**What changed:**
- Topic picker now prefers topics tagged for the current slot's time_of_day
- Matching topics get 1.3x boost in Thompson sampling
- Non-matching topics get 0.7x penalty
- Topics without time_of_day tags work at any time (no boost/penalty)

**Example:**
- 7am slot → prefers morning-tagged topics (commute, breakfast)
- 9pm slot → prefers evening-tagged topics (food, family, reflection)

### 3. Psychology technique validation (qa_persona.js)

**What changed:**
- QA gate now checks that at least one assigned psychology technique is present in the generated post
- Uses marker patterns to detect technique presence (e.g., `participation_loop` looks for questions asking for input)
- If no assigned technique is detected, the post is rejected with reason: "no assigned psychology technique detected"

**Marker patterns:**
```javascript
{
  reciprocity_first: /\b(petua|tip|cara|boleh cuba|kalau|cuba)\b/i,
  liking_through_specificity: /\b(flat|ampang|shah alam|rapidKL|petronas|waze|grab|shopee)\b/i,
  unity_shared_identity: /\b(ibu (bekerja|kerja)|fresh grad|anak rantau|student|guru|nurse|rider)\b/i,
  punctuation_signals_tone: true,  // always passes (structural)
  clarity_over_cleverness: true,   // always passes (structural)
  write_like_you_talk: /\b(tak|nak|kat|je|lah|kan|kot)\b/i,
  cut_ruthlessly: true,  // always passes (structural)
  participation_loop: /\b(korang (guna|ada|macam)|tempat korang|ada (petua|tip)|macam mana)\b.*\?/i,
  belonging_signal: /\b(kita semua|kita pun|kita (tahu|faham))\b/i,
}
```

### 4. Enhanced writer prompt (persona_writer.md)

**What changed:**
- Added `slot.time_of_day` and `slot.psychology_techniques` to the assignment section
- Added "Psychology technique guide" section that explains each assigned technique
- LLM is instructed to weave techniques naturally without naming them

**Example prompt section:**
```markdown
### Psychology technique guide
- **belonging_signal**: When sharing a struggle, use "kita" (we inclusive) to signal shared experience. When sharing a win or tip, use "saya" to avoid sounding preachy.
- **participation_loop**: Ask for one specific piece of input: "korang guna yang mana?", "ada petua lain?", "tempat korang macam ni juga ke?". Never ask "macam mana?" (too broad).
```

---

## L4 Reply Loop Improvements

### 1. Comment planning (l4_reply_plan.js)

**What it does:**
- Fetches published posts from the last N days with unreplied comments
- Applies rate limiting (max 10 replies/day, max 5 per post, 24h cooldown per user)
- Filters out bot comments, self-replies, very short comments
- Scores comments by priority (questions > link inquiries > experience questions > compliments > banter)
- Outputs one item per candidate comment with post context

**Scoring formula:**
```javascript
score = 0;
if (text.includes('?')) score += 10;  // questions are highest priority
if (/\b(link|beli|mana|harga)\b/.test(text)) score += 8;  // link/price inquiries
if (/\b(tahan|ok ke|berkesan)\b/.test(text)) score += 6;  // experience questions
if (/\b(best|bagus|thank)\b/.test(text)) score += 3;  // compliments
score += Math.min(5, text.length / 30);  // longer comments show more engagement
if (post.purpose === 'persona') score += 2;  // persona posts get slight boost
score += Math.max(0, 5 - ageHours / 6);  // recency boost
```

### 2. Intent classification (l4_classify_intent.js)

**What it does:**
- Classifies user comments into 9 intent categories using keyword/pattern matching
- Assigns psychology techniques based on intent
- Determines reply strategy

**Intent categories:**
1. `link_inquiry` — "Beli kat mana?", "PM link"
2. `price_inquiry` — "Berapa RM?", "Mahal tak?"
3. `experience_inquiry` — "Tahan lama tak?", "Ok ke?"
4. `compatibility_inquiry` — "Boleh guna kat iPhone tak?", "Saiz besar mana?"
5. `complaint` — "Tak puas hati", "Rosak"
6. `compliment` — "Best!", "Comel sangat"
7. `question` — general questions not covered above
8. `casual_banter` — "Haha", "Same", "Relate"
9. `other` — fallback

**Psychology techniques by intent:**
```javascript
{
  link_inquiry:    ['leave_better', 'calibrated_question'],
  price_inquiry:   ['tactical_empathy_label', 'leave_better'],
  experience_inquiry: ['mirror_last_three', 'leave_better'],
  compatibility_inquiry: ['calibrated_question', 'leave_better'],
  complaint:       ['tactical_empathy_label', 'bury_boomerangs', 'listen_longer'],
  compliment:      ['bury_boomerangs', 'participation_loop'],
  question:        ['mirror_last_three', 'calibrated_question'],
  casual_banter:   ['belonging_signal', 'participation_loop'],
  other:           ['listen_longer'],
}
```

**Reply strategies:**
```javascript
{
  link_inquiry:    'point_to_link',
  price_inquiry:   'state_price_or_link',
  experience_inquiry: 'share_experience',
  compatibility_inquiry: 'answer_facts',
  complaint:       'empathize_and_help',
  compliment:      'thank_and_engage',
  question:        'answer_and_ask_back',
  casual_banter:   'banter_back',
  other:           'acknowledge',
}
```

### 3. Reply QA gate (l4_qa_reply.js)

**What it checks:**
1. **Length** — under 180 chars (configurable)
2. **Indonesian words** — blocks "banget", "nggak", "bisa", "butuh", etc.
3. **Hard-sell language** — blocks "beli sekarang", "stok terhad", "wajib ada"
4. **Link/CTA** — only allowed if intent is `link_inquiry`
5. **Aggressive empathy** — blocks "saya faham sangat masalah anda"
6. **Shouting** — blocks 2+ ALL-CAPS words
7. **Emoji cap** — max 1 emoji
8. **Psychology technique validation** — at least one assigned technique must be present
9. **Persona post guard** — persona replies can't mention products/prices/links
10. **Spec fabrication** — flags replies with many numbers not in the post (soft check)

### 4. Enhanced reply prompt (reply_assistant.md)

**What changed:**
- Fixed merge conflict markers
- Added intent detection and reply strategy
- Added psychology technique guide section
- LLM is instructed to apply techniques naturally

**Example prompt section:**
```markdown
Detected intent: **price_inquiry** (state_price_or_link)

### Psychology techniques to apply
- **tactical_empathy_label**: Acknowledge their emotion with "macam [frustrated/excited/confused] je" or "faham sangat" before answering.
- **leave_better**: Include one specific useful detail they didn't have before (a timing, a comparison, a warning, a tip).
```

---

## Integration Points

### wf4 → wf6 feedback loop

**How it works:**
1. wf4_evaluate scores a published persona post (engagement metrics: likes, replies, reposts, quotes, views)
2. wf4 writes a row to `persona_topic_feedback` with the engagement_score and reward
3. wf6_persona reads recent feedback and updates `persona_topics.alpha/beta` via Thompson sampling
4. Topics with high engagement get higher alpha (more likely to be picked)
5. Topics with low engagement get higher beta (less likely to be picked)

**SQL to update topic bandit:**
```sql
UPDATE persona_topics pt
SET 
  alpha = alpha + COALESCE(SUM(ptf.reward), 0),
  beta = beta + COUNT(ptf.id) - COALESCE(SUM(ptf.reward), 0),
  n = n + COUNT(ptf.id)
FROM persona_topic_feedback ptf
WHERE ptf.persona_topic_id = pt.id
  AND ptf.created_at > now() - interval '24 hours'
GROUP BY pt.id;
```

### wf3_publish → L4 reply loop

**How it works:**
1. wf3_publish publishes a post (persona or product)
2. L4 reply loop runs every 4 hours (configurable)
3. L4 fetches posts published in the last 7 days with unreplied comments
4. L4 classifies intent, drafts reply with psychology techniques, passes QA, publishes reply
5. L4 writes a row to `l4_replies` for audit and rate limiting

---

## Testing & Validation

### Unit tests
All new code nodes should be tested with:
```bash
node --check n8n/code/persona_slot_plan.js
node --check n8n/code/persona_topic_pick.js
node --check n8n/code/qa_persona.js
node --check n8n/code/l4_reply_plan.js
node --check n8n/code/l4_classify_intent.js
node --check n8n/code/l4_qa_reply.js
```

### SQL validation
```bash
python3 -m json.tool db/migrations/011_persona_l4_improvements.sql
```

### Workflow validation
After importing wf6_persona.json and wf7_l4_reply.json into n8n:
1. Check all Postgres nodes have credentials assigned
2. Check all HTTP nodes have the correct base URL
3. Run a test execution with mock data
4. Verify posts are queued with `psychology_techniques` populated
5. Verify L4 replies are drafted with correct intent classification

---

## Deployment Checklist

- [ ] Run `./scripts/init_db.sh` to apply migration 011 and seed psychology techniques
- [ ] Import updated `n8n/workflows/wf6_persona.json` into n8n
- [ ] Import new `n8n/workflows/wf7_l4_reply.json` into n8n (when ready)
- [ ] Assign Postgres credentials to all Postgres nodes
- [ ] Set `settings.l4_reply.enabled = true` when ready to activate L4
- [ ] Monitor `persona_topic_feedback` table for wf4→wf6 feedback
- [ ] Monitor `l4_replies` table for reply actions and QA rejections
- [ ] Check `run_log` for any errors

---

## Future Enhancements

1. **wf7_l4_reply.json workflow** — Build the actual n8n workflow JSON using the new code nodes
2. **A/B testing** — Test psychology techniques against each other to see which drive highest engagement
3. **Sentiment analysis** — Use LLM to detect comment sentiment (positive/negative/neutral) and adjust reply tone
4. **Multi-language support** — Extend intent classification to handle English and Manglish comments
5. **Human approval queue** — Add UI for reviewing drafted replies before publishing (when `human_approval_required = true`)
6. **Topic clustering** — Group similar persona topics to avoid repetition within the same week
7. **Seasonal topics** — Add Hari Raya, Chinese New Year, Deepavali, Christmas topics with time_of_day = ['seasonal']

---

## Summary

These improvements make wf6_persona and the L4 reply loop more sophisticated and effective:

- **Psychology techniques** ensure posts and replies are grounded in proven persuasion principles
- **Time-of-day awareness** makes persona posts feel more natural (morning commute vs evening reflection)
- **Intent classification** ensures L4 replies are contextually appropriate
- **Feedback loop** allows the system to learn which topics drive engagement
- **QA gates** prevent low-quality or off-brand content from being published

Total techniques now: **93** (43 built-in + 22 books + 11 2026 threads + 17 psychology)

All changes are backward compatible and idempotent. Existing posts and workflows continue to work as before.
