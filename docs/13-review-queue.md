# Human-in-the-Loop Review Queue

> Every generated post passes through human review before publication, backed by an auto-publish timeout safety net and feedback-driven scoring.

---

## 1. What it does

The Human-in-the-Loop review layer gives you absolute editorial control over your Threads account without requiring external SaaS tools like Airtable or Notion. When workflow `wf2_generate` creates posts, instead of immediately queuing them for publication, they enter a `pending_review` state. You can inspect, approve, reject, or edit any generated draft via a secure web dashboard before it ever touches Threads. If you don't review in time, a safe timeout mechanism handles auto-publishing so your posting schedule is never missed.

---

## 2. Where to open it and how to log in

- **URL:** `https://kb.yourdomain.com/queue.html`
- **Authentication:** Protected by the same shared `KB_PASSWORD` configured in your `infra/.env` file. If Cloudflare Access is enabled on your subdomain, you will also authenticate via your authorized email.

---

## 3. What each action button does

In the Daily Queue (`/queue.html`), every pending draft card provides:
- Live countdown timer to auto-publish timeout
- Prominent badge if the post is a deliberate **`[EXPLORATION PROBE`** selected by the multi-armed bandit
- Inline editable text area containing the generated copy

| Action Button / Input | What happens | Post state | Human feedback signal |
|---|---|---|---|
| **Approve** | Accepts the draft as-is. It is now cleared for publication by `wf3_publish`. | `approved` | `+1.0` (positive) |
| **Save & Approve Edit** | Updates the post body text in the database with your edits and approves it for publication. | `approved` (with `edited_body`) | `+1.0` (positive) |
| **Reject** + Reason Code | Rejects the draft. It will not be published (status marked `failed`). Requires choosing a reason code (`off_tone`, `factual_error`, `too_salesy`, `banned_phrase_adjacent`, `other`). | `rejected` | `-1.0` (negative) |

---

## 4. Auto-publish on timeout

If life gets busy and you don't review a post before its timeout window arrives:
- **Default timeout:** 120 minutes (2 hours) before the scheduled posting time (`review_timeout_at`).
- **Timeout sweep:** Every time `wf3_publish` runs (every 5 minutes), it sweeps for overdue `pending_review` posts and automatically promotes them to `auto_published`.
- **Pre-generated variant:** The system publishes whatever variant the bandit's best arm already generated during intake—it **never re-rolls** or generates new copy at publish time.
- **Active review lock protection:** If you have opened a post in the review dashboard (`/queue.html`), the browser automatically locks it via `/api/posts/:id/lock`, setting `review_locked_until` (10-minute sliding TTL). The timeout sweep **strictly respects** this lock and will never auto-publish a post out from under you while you are actively reading or editing it.

---

## 5. The Weekly Summary View

Switching to the **Weekly Summary & Stats** tab in `/queue.html` provides operational visibility:
- **Review Status Counts:** Overview of how many posts are pending, approved, rejected, or auto-published.
- **Arm Stats:** Current performance weights of the multi-armed bandit levers (format, angle, tone, etc.).
- **Recent Audit Log:** Complete decision history showing whether posts were human-approved, human-rejected (with reason codes), human-edited, or auto-published on timeout.

---

## 6. How your decisions affect scoring

Your editorial decisions do more than gate publication—they directly inform what the multi-armed bandit learns:
- **Human Feedback Integration:** Every approval/edit (`+1.0`) and rejection (`-1.0`) is recorded in `post_review` and aggregated via the `post_human_feedback` database view.
- **Scoring Weight (`w_human`):** In `n8n/code/scoring.js`, human feedback is folded into the post's `final_score` alongside engagement and Shopee conversion data using a configurable weight (`settings.scoring.w_human`, default **0.15**).
- **Eligibility Safeguard:** Human feedback **cannot** bypass the under-distribution safeguard (`!r.eligible`). A post with low views remains clamped to low scores regardless of human approval, ensuring scores are earned through real-world performance.
- **Exploration Probes:** When the bandit intentionally explores an unproven arm (`was_probe = true`), any rejection is tracked separately (`probe_rejections` in the lever report) so that rejecting an exploratory arm does not silently zero out and starve exploration on that lever.

---

## 7. Common mistakes to avoid

1. **Rejecting exploration probes out of caution:** The bandit intentionally tests unconventional angles or tones to discover new winners. Rejecting a probe simply because it "feels unusual" starves the algorithm of exploration data. Let probes run unless they violate safety or brand guidelines.
2. **Letting the queue pile up:** If you ignore the queue and let every post time out to auto-publish, the human review step becomes ceremonial in practice. Review daily or adjust `review_timeout_minutes` to match your operational cadence.
3. **Leaving tabs open without saving edits:** Always click **Save & Approve Edit** if you make changes in the textarea. Simply typing without clicking save leaves the draft unmodified.
