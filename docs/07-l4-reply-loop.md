# Loop L4 — On-Post Reply Engagement

> **Pivot from Karma (`wf6_karma`):** External thread search and unsolicited commenting (`wf6_karma`)
> are not supported by the official Threads API and carry a high risk of account suspension.
> The **L4 Reply Loop** replaces karma by focusing on **high-ROI engagement on your own Threads posts**.

---

## Purpose

To build real account engagement and algorithm reach by responding to real user comments on your published Threads posts. 

When users ask questions (*"Berapa RM?", "Tahan lama tak?", "Beli kat mana?"*), Loop L4 drafts natural, persona-calibrated responses in everyday Malaysian Malay.

---

## How It Works

1. **Fetch Comments:** Every 4–6 hours, queries the official Threads API endpoint:
   `GET https://graph.threads.net/v1.0/{media_id}/replies` for posts published in the last 7 days.
2. **Filter Candidates:** Ignores bot comments, duplicate replies, and self-replies.
3. **Persona Calibration:** Injects 1–3 persona snippets from `persona_snippets` / `dataset-1.json` (e.g. casual Facebook / IIUM Confession Malay cadence) into `prompts/reply_assistant.md`.
4. **Draft Reply:** LLM produces a 1-sentence friendly, helpful response in everyday Malaysian Malay.
5. **QA Gate:** Verifies length (<180 chars), blocks Indonesian words (*bisa*, *butuh*, *banget*), and ensures no unsolicited hard-selling.
6. **Publish Reply:** Posts via `POST https://graph.threads.net/v1.0/{comment_id}/replies`.

---

## Persona Dataset Integration

The `/persona` dataset (`dataset-1.json` to `dataset-10.ipynb` and `persona_snippets`) is integrated directly into L4 to ensure replies sound like an authentic Malaysian user (*orang biasa*) rather than a customer service bot:

- **Tone Alignment:** Uses casual conversational snippets for natural phrasing (*"Ha'ah, haritu I guna ok je..."*, *"Link I dah drop kat komen bawah tau"*).
- **Domain Matching:** Uses tech review snippets (`amanz.my`) when answering questions about tech products, and lifestyle snippets (`iium`, `facebook`) for home/lifestyle products.

---

## Safety & Rate Limits

- **Daily Cap:** Max 10 replies/day across all active posts.
- **Cooldown:** Max 1 reply per user per post.
- **Human Approval Option:** Can be set to `status='pending_approval'` in `run_log` for manual review before publishing.
