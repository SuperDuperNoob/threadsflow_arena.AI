# Your Books/ folder — what was extracted and what was deliberately rejected

You pushed 26 copywriting PDFs. Here's what happened to them.

---

## 1. What's in the folder

| | Count | Notes |
|---|---|---|
| Malay ebooks | 19 | headlines, ayat jualan, close-sale, social content |
| English books | 4 | storytelling and visual storytelling |
| **Scanned (no text layer)** | **3** | cannot be read — see below |
| Total pages | ~2,100 | |

**These 3 are images, not text**, so nothing can be extracted from them:

- `50 Headline Power Proven.pdf` — 13 pages, 24 characters of text
- `TEKNIK COPYWRITING.pdf` — 9 pages, 16 characters
- `Ebook - Strategi Tulis Headline Sentap Emosi.pdf` — 9 pages, 970 characters

To use them, run OCR first, then upload through the KB page:

```bash
ocrmypdf -l msa+eng "Books/TEKNIK COPYWRITING.pdf" "Books/TEKNIK COPYWRITING.ocr.pdf"
```

---

## 2. A bug your books exposed

The chunk scorer — the part that decides which pages are worth sending to the AI — only knew
English keywords (`technique`, `headline`, `never`, `because`). Your Malay books scored almost
zero and would have been **silently skipped**.

Measured on your actual folder:

| | Before | After |
|---|---|---|
| `Headlines produk.pdf` | 6 useful chunks | **63** |
| `101 storytelling.pdf` | 1 | **14** |
| `50 Ayat Iklan Promosi Cun.pdf` | 0 | **8** |
| Whole folder | 284 | **465** |

The scorer now knows Malay (`teknik`, `tajuk`, `jangan`, `sebab`, `pelanggan`, `contoh`…) and
counts numbered lists, because that's how Malay ebooks present technique.

Worth saying plainly: without this fix, uploading your Malay books would have appeared to work
and produced almost nothing.

---

## 3. The important editorial decision

**Most of your Malay books teach 2015-era Facebook-ads hard sell.** Measured:

| Book | ALL-CAPS words | Hype triggers |
|---|---|---|
| `Headlines produk.pdf` | 17,146 | 492 |
| `800 Headline Catchy.pdf` | 3,812 | 47 |

That style — `RAHSIA TERBONGKAR!`, `PERCUMA!`, `PM saya sekarang` — was effective in Facebook ads
a decade ago. **On Threads in 2026 it is the fastest way to get your account down-ranked and
reported.** Copying it would destroy the account this system exists to grow.

So the rule I applied: **keep the mechanism, reject the surface style.**

Example — the books teach:
> "Perkataan ajaib: PERCUMA, RAHSIA, TERBONGKAR, EKSKLUSIF, TERBUKTI"

What went into the database instead is the *opposite*, as an enforced rule:
> `no_magic_words` — Never use PERCUMA, RAHSIA, TERBONGKAR, EKSKLUSIF, TERBUKTI or DISKAUN as
> attention devices. *These were magic in 2015 print and Facebook ads; after a decade of overuse
> they now mark a post as an advertisement within one line.*

**The books' greatest value turned out to be as a catalogue of what NOT to do.** They show
exactly what Malaysian hard-sell looks like, which is precisely what must never be published.

---

## 4. What's now in the database

**17 techniques** in `db/seed_techniques_books.sql`, on top of the 43 built-in ones (60 total).

Useful mechanisms extracted:

| Technique | From | What it does |
|---|---|---|
| `one_message_one_person` | 26.Ebook mudahnya copywriting | One problem, one kind of person, per post |
| `problem_before_offer` | 7-teknik-close-sale | Name the problem before the solution exists |
| `price_last` | 7-teknik-close-sale | Price is step 7 of 7, never step 1 |
| `benefit_not_feature` | Mudahnya-Jual-Produk | Sell the changed day, not the object |
| `dialogue_frame` | Headlines produk | Two people talking, no narration |
| `transformation_numbers` | 101 storytelling | "Dulu 20 minit. Sekarang 4 minit." |
| `struggle_before_success` | The Storyteller's Secret | Mostly struggle, one line of resolution |
| `one_specific_scene` | The Storyteller's Secret | One place, one moment, not a summary |
| `data_plus_one_person` | The Storyteller's Secret | A statistic needs a face |
| `customer_is_hero` | Laws of Brand Storytelling | Reader is the subject, never the product |
| `show_dont_narrate_image` | Power of Visual Storytelling | Caption says what the photo can't |

Rejected as harmful, now **blocked automatically**:

| Blocked | Why |
|---|---|
| `no_magic_words` | PERCUMA / RAHSIA / TERBONGKAR / EKSKLUSIF |
| `no_hard_close` | "PM saya sekarang", "klik link sekarang" |
| `no_caps_headline` | 3+ ALL-CAPS words in a post |
| 6 new regex patterns | catalogue language, fake urgency, empty praise |

**3 marked `contested`** — the books disagree with each other, so your real sales data decides:

- `answer_first_question` — Malay books say state the benefit immediately; the storytelling books
  say delay it. Both are in your library.
- `question_then_gap` — the most-taught device here, and also the most exhausted on social feeds.
- `sold_count_proof` — only works when the number is genuinely large.

Check the verdicts after ~6 cycles:

```sql
SELECT * FROM v_contested_verdicts;
```

---

## 5. A second bug, caught while testing

My first attempt at the ALL-CAPS ban was a database rule: `([A-Z]{4,}\s+){3,}`.

PostgreSQL matches the ban list **case-insensitively**, so `[A-Z]` also matched lowercase. It
blocked 4 out of 5 perfectly good Malay test sentences — it would have rejected nearly every post
the system ever wrote.

The shouting check now lives in `n8n/code/qa.js`, where case-sensitivity is under control, and it
ignores legitimate capitals like RM, OK, USB, LED. Verified 4/4 against good and bad copy.

---

## 6. Adding more books later

Two options.

**Option A — the KB web page.** Drag PDFs onto `https://kb.yourdomain.com`. Full automatic
pipeline with deduplication, so re-uploading the same book is harmless.

**Option B — bulk script.**
```bash
./scripts/ingest_books.sh https://kb.yourdomain.com
```

Both need an LLM endpoint configured. Neither was runnable in the sandbox where these techniques
were extracted, which is why `seed_techniques_books.sql` exists — same books, mined by hand.

**Whichever you use, review before the new techniques consume posting slots:**

```sql
SELECT code, type, instruction FROM techniques WHERE n = 0 ORDER BY created_at DESC;
UPDATE techniques SET enabled = false WHERE code IN ('one_you_dislike');
```

A bad technique doesn't just make one bad post — it burns slots for a whole 3-day cycle before
the bandit can down-weight it.
