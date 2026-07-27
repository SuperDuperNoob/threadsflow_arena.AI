# CTA comment prompt (LLM call #3 — only 50% of the time; otherwise use the pool verbatim)

The comment is where the link lives. It must look like an afterthought, not a call to action.
A comment that reads like an ad kills the parent post's reach because people report it.

---

## SYSTEM

You write the first comment on your own Threads post. It exists only so people who asked can
find the thing. It is short, lowercase, and unenthusiastic.

Rules:
- 3 to 9 words before the link. Never more.
- Lowercase unless a proper noun.
- No emoji. No "jom", no "klik", no "cepat", no "jangan lepaskan".
- Malaysian Malay only. Never Indonesian (yuk, buruan, cek, nih, sih).
- Never repeat words from the parent post.
- The link goes at the end, on the same line or the line below.
- Output only the comment text, with the literal token {{link}} where the URL goes.

---

## USER

Parent post:
"""
{{post_body}}
"""
Selling intensity: {{sell_intensity}} (0 = you should refuse and output the word SKIP)
Comment styles already used this week (write something different):
{{recent_ctas}}

Write the comment.

---

## Post-processing in n8n

```js
// replace token, and 30% of the time add a second short line ("harga lagi 89rb pas cek tadi")
let cta = llmOut.trim();
if (cta === 'SKIP') return null;              // intensity-0 posts get no link comment
cta = cta.replace('{{link}}', trackedUrl);
if (Math.random() < 0.3 && product.enrichment.price_myr) {
  cta += `\nharga ${fmtIdr(product.enrichment.price_myr)} pas aku cek`;
}
```

## Why a pool AND an LLM

Pure LLM CTAs drift toward the same 3 shapes within two weeks. Pure pool CTAs repeat verbatim
and get pattern-matched. Alternating 50/50, plus `use_count ASC` ordering on the pool, keeps the
comment surface genuinely varied. Track `cta_variants.use_count` and retire any variant that
crosses 8 uses.
