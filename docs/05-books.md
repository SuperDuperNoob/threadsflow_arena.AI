# Your Books/ folder — what was extracted and what was deliberately rejected

You pushed 40 PDFs plus 1 Markdown strategy note into `Books/`. Here is what happened to them.

---

## 1. What's in the folder

| | Count | Notes |
|---|---|---|
| Malay ebooks (classic FB/WhatsApp-era copywriting) | 15 | headlines, ayat jualan, social content |
| 2026 Threads Mastery series (Hizami Radzi) | 5 | Threads Income Mastery v2, Content Machine Playbook, Profit Killer, Bonus 1–3 |
| English books (storytelling / visual storytelling) | 3 | storytelling, brand storytelling, infographics |
| **English books (psychology & communication)** | **7** | Cialdini, Voss, Dhawan, Handley, Carnegie (2), Bacon |
| Headline-template packs (shallow) | 9 | bulk "800 headlines" lists — very low signal |
| Strategy note (Markdown) | 1 | `Threads_Affiliate_Marketing_2026_Strategies.md` |
| **Scanned (no text layer, needs OCR)** | **2** | see below |
| Total | **41 files** | |

**Scanned / image-only PDFs** — these have no extractable text layer, so nothing can be mined from them until OCR is run:

- `50 Headline Power Proven.pdf`
- `TEKNIK COPYWRITING.pdf`

`Ebook - Strategi Tulis Headline Sentap Emosi.pdf` was previously flagged as scanned but does contain a real text layer (it begins with a "PENAFIAN" disclaimer page that made the initial sample look empty) — it is included in the seed.

To OCR the two scanned files (requires `ocrmypdf` + Tesseract `msa`+`eng` language packs):

```bash
ocrmypdf -l msa+eng "Books/50 Headline Power Proven.pdf" "Books/50 Headline Power Proven.ocr.pdf"
ocrmypdf -l msa+eng "Books/TEKNIK COPYWRITING.pdf"  "Books/TEKNIK COPYWRITING.ocr.pdf"
```

After OCR, upload the `.ocr.pdf` versions through the KB web page (see §6).

---

## 1b. New English Psychology & Communication Books (2026-07-31 audit)

Seven English-language psychology and communication books were added and audited for persona warm-up mechanisms:

| Book | Author | Key mechanisms extracted |
|---|---|---|
| `Influence, New and Expanded` | Robert Cialdini | Reciprocity (give first), liking through specificity, subtle social proof, unity/shared identity |
| `Never Split the Difference` | Chris Voss | Tactical empathy (label emotions), mirroring (repeat last 1-3 words), calibrated questions ("macam mana" not "kenapa"), late-night FM DJ voice (calm, slow, periods not exclamation marks) |
| `Digital Body Language` | Erica Dhawan | Punctuation signals tone (period = serious, no period = casual), clarity over cleverness (one idea per sentence) |
| `Everybody Writes` | Ann Handley | Write like you talk (BM pasar contractions), cut ruthlessly (every sentence must earn its place) |
| `How to Win Friends Digital Age` | Dale Carnegie Associates | Bury boomerangs (don't pivot back to yourself), listen longer (ask 2 questions before sharing), leave others better (one useful detail per reply) |
| `How to Win Friends, Revised Edition` | Dale Carnegie | Core principles (affirm what's good, take interest in others' interests) — overlaps with Digital Age version |
| `The Art of Community` | Jono Bacon | Participation loops (ask for specific input, not broad opinions), belonging signals ("kita" for struggles, "saya" for wins) |

**Editorial decision for psychology books:** These books teach PRINCIPLES, not templates. The mechanisms extracted are **guardrails for the persona layer**, not fill-in-the-blank formulas. For example:

- Cialdini's reciprocity principle → `reciprocity_first` technique (give value before asking)
- Voss's mirroring → `mirror_last_three` technique (repeat their last 1-3 words as a question)
- Dhawan's punctuation signals → `punctuation_signals_tone` technique (period = serious, no period = casual)

**Manipulative surface tactics were banned:** The books also document harmful versions of these principles that get you flagged as an ad. These were added to `banned_phrases`:

- Artificial scarcity ("stok terhad", "last chance") — the harmful version of Cialdini's scarcity principle
- Manufactured social proof ("1000 orang dah beli") — the harmful version of `social_proof_subtle`
- False authority ("pakar", "certified", "terbukti secara saintifik") — claiming expertise you don't have
- Manipulative reciprocity ("ambil percuma", "claim sekarang") — offering "free" things to trigger obligation
- Aggressive empathy scripts ("saya faham sangat masalah anda") — the harmful version of tactical empathy

**Integration with persona warm-up:** These techniques are specifically designed for the `wf6_persona` workflow and the warm-up phase (first 14-16 days). They complement the existing 2026 Threads techniques:

- `reciprocity_first` + `zero_sell_ratio` → persona posts build goodwill before any sell
- `tactical_empathy_label` + `mirror_last_three` + `calibrated_question` → reply-marketing and L4 engagement
- `late_night_dj_voice` + `punctuation_signals_tone` → trustworthy tone for sell posts
- `write_like_you_talk` + `cut_ruthlessly` → conversational editing pass

All 17 new techniques are marked `review_state='approved'` and ready for the bandit to test.

---

## 2. Two bugs your books exposed

### 2a. English-only chunk scorer (fixed)
The chunk scorer — the part that decides which pages are worth sending to the AI — only knew
English keywords (`technique`, `headline`, `never`, `because`). Your Malay books scored almost
zero and would have been **silently skipped**.

Measured on the original 26-book set:

| | Before | After |
|---|---|---|
| `Headlines produk.pdf` | 6 useful chunks | **63** |
| `101 storytelling.pdf` | 1 | **14** |
| `50 Ayat Iklan Promosi Cun.pdf` | 0 | **8** |
| Whole folder | 284 | **465** |

The scorer now knows Malay (`teknik`, `tajuk`, `jangan`, `sebab`, `pelanggan`, `contoh`…) and
counts numbered lists, because that is how Malay ebooks present technique.

### 2b. Case-insensitive regex in Postgres (fixed in QA gate)
My first attempt at an ALL-CAPS ban was a database rule: `([A-Z]{4,}\s+){3,}`.
PostgreSQL matches the ban list **case-insensitively**, so `[A-Z]` also matched lowercase — it
would have rejected nearly every Malay post the system ever wrote. The shouting check now lives
in `n8n/code/qa.js`, where case-sensitivity is under control, and it ignores legitimate capitals
(RM, OK, USB, LED, KL, JB, PJ).

---

## 3. The editorial decision

**Most pre-2020 Malay copywriting books teach 2015-era Facebook-ads hard sell.** Measured:

| Book | ALL-CAPS words | Hype triggers |
|---|---|---|
| `Headlines produk.pdf` | 17,146 | 492 |
| `800 Headline Catchy.pdf` | 3,812 | 47 |

That style — `RAHSIA TERBONGKAR!`, `PERCUMA!`, `PM saya sekarang` — was effective in Facebook ads
a decade ago. **On Threads in 2026 it is the fastest way to get an account down-ranked and
reported.** Copying it would destroy the account this system exists to grow.

The rule applied throughout: **keep the mechanism, reject the surface style.**

Example — the books teach:
> "Perkataan ajaib: PERCUMA, RAHSIA, TERBONGKAR, EKSKLUSIF, TERBUKTI"

What went into the database instead is the *opposite*, as an enforced rule:
> `no_magic_words` — Never use PERCUMA, RAHSIA, TERBONGKAR, EKSKLUSIF, TERBUKTI or DISKAUN as
> attention devices. *These were magic in 2015 print and Facebook ads; after a decade of overuse
> they now mark a post as an advertisement within one line.*

**The books' greatest value turned out to be as a catalogue of what NOT to do.** They show
exactly what Malaysian hard-sell looks like, which is precisely what must never be published.

The 2026 Threads Mastery series (Hizami Radzi) was different — those three ebooks + three bonuses
were written *for* Threads in 2026 and directly informed the HVCT structure, Ghost Hook v2,
reply-marketing rules, and zero-sell ratio that ship as defaults. Mechanisms from those books
were added on top of (and sometimes in tension with) the older storytelling books; those
tensions are flagged `contested` so real engagement data decides.

---

## 4. What's now in the database

**22 techniques** from the original seed (`db/seed_techniques_books.sql`), plus **11 more** from
the 2026 Threads series + classic BM copywriting books (`db/seed_techniques_2026_threads.sql`),
plus **17 more** from English psychology & communication books (`db/seed_techniques_psychology.sql`),
on top of the 43 built-in ones (≈93 total after all seeds run).

### From the original Books/ batch (seed_techniques_books.sql)

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
| `hook_berhantu_ghost_curiosity` | 30 Formula Hook Berhantu | High-tension mystery opening |
| `hyper_local_slang_pattern` | Threads Mastery | Signaling authenticity with slang |
| `low_friction_cta_replies` | Threads Profit Machine | Algorithm-safe link placement |
| `stacked_value_thread` | Threads Mastery | Reciprocity before the offer |
| `pattern_interrupt_gaul` | Content Machine | Visual disruption for busy feeds |

### From the 2026 Threads + classic BM batch (seed_techniques_2026_threads.sql)

| Technique | From | What it does |
|---|---|---|
| `ghost_hook_v2` | Threads Income Mastery v2, Content Machine Playbook, Bonus 1 Hook Berhantu v2, Threads_Affiliate_Marketing_2026_Strategies.md | Name the result/mystery change, not the category, for ≥2 lines |
| `hvct_structure` | Content Machine Playbook | Hook → Value → Conflict → Takeaway, in that order |
| `reply_marketing` | Profit Killer mistake #6 | Reply to every comment in the first 20 min with a follow-up question |
| `niche_positioning` | Threads Income Mastery Bab 2 | Name one exact person (e.g. "ibu 2 anak rumah flat"), never "korang semua" — *contested* vs universal-relatability storytelling |
| `three_second_win` | Mudahnya-Jual-Produk-Kurang-7-Saat | <9-word numeric lead that states the measurable win |
| `anti_post_and_ghost` | Profit Killer mistake #6 | Never schedule and walk away — a rule, not a technique |
| `zero_sell_ratio` | Content Machine Playbook pillar 1, 2026 strategy note §4 | 1-in-4 posts has no product / price / link (wf6 persona posts enforce this) |
| `voice_of_prospect` | Ebook-AJMP (Umar Taib), Kopi Writing | Open with a sentence the reader has literally said out loud this week |
| `benefit_under_nine_words` | Kurang 7 Saat Teknik #2 | Lead with a single ≤9-word benefit phrase, with a number if possible |
| `pain_dream_bridge` | Kopi Writing / Teknik Mudah Ayat Jualan / 30-point | Pain line → dream after-state line → bridge ("ini yang bawa kau ke sana") |
| `specific_dream` | 30-point copywriting, 2026 strategy note | Name a specific mundane 10-second after-state (e.g. "sempat bancuh teh sementara periuk rendam"), not "senang" / "jimat masa" |
| `objection_preempt` | 30-point questions 21–24, Kurang 7 Saat | Answer the silent objection (price, fit, penat) on line 3 — don't wait for comments |

### From psychology & communication theory (seed_techniques_psychology.sql)

| Technique | From | What it does |
|---|---|---|
| `reciprocity_first` | Cialdini Influence | Give value in persona posts before any sell — builds goodwill bank |
| `liking_through_specificity` | Cialdini Influence | Name one specific shared detail (place, time, struggle) to signal "I am like you" |
| `social_proof_subtle` | Cialdini Influence | "Ramai tanya" not "ramai beli" — conversational social proof, not numerical |
| `unity_shared_identity` | Cialdini Influence (expanded) | Name the group the reader belongs to before mentioning the product |
| `tactical_empathy_label` | Voss Never Split the Difference | Label the commenter's emotion ("macam frustrated je") before answering |
| `mirror_last_three` | Voss Never Split the Difference | Repeat their last 1-3 words as a question to invite elaboration |
| `calibrated_question` | Voss Never Split the Difference | Ask "macam mana" not "kenapa" — invites context, not defensiveness |
| `late_night_dj_voice` | Voss Never Split the Difference | Calm, slow, periods not exclamation marks — signals trustworthiness |
| `punctuation_signals_tone` | Dhawan Digital Body Language | Period = serious/factual, no period = casual, never exclamation marks |
| `clarity_over_cleverness` | Dhawan Digital Body Language | One idea per sentence — if it has "dan" or "tapi", split it |
| `write_like_you_talk` | Handley Everybody Writes | BM pasar contractions, sentence fragments, start with "Dan"/"Tapi" |
| `cut_ruthlessly` | Handley Everybody Writes | Every sentence must earn its place — delete "sangat bagus", "memang berbaloi" |
| `bury_boomerangs` | Carnegie Win Friends Digital Age | Don't pivot back to yourself in replies — answer their question fully first |
| `listen_longer` | Carnegie Win Friends Digital Age | Ask 2 questions before sharing your take — signals listening, not broadcasting |
| `leave_better` | Carnegie Win Friends Digital Age | One useful detail per reply (timing, comparison, warning, tip) |
| `participation_loop` | Bacon Art of Community | Ask for specific input ("korang guna yang mana?") not broad opinions |
| `belonging_signal` | Bacon Art of Community | "Kita" for struggles, "saya" for wins — subtle unity signaling |

### Rejected as harmful — now blocked automatically

| Blocked | Why |
|---|---|
| `no_magic_words` (seed) | PERCUMA / RAHSIA / TERBONGKAR / EKSKLUSIF |
| `no_hard_close` (seed) | "PM saya sekarang", "klik link sekarang" |
| `no_caps_headline` (QA gate) | 3+ ALL-CAPS words in a post |
| 2026 anti-patterns (seed_techniques_2026_threads.sql) | "game changer", "wajib ada", "berbaloi sangat", "content creator / reach / viral" jargon, "jangan lepaskan / stok terhad" artificial urgency, "DM/PM/wasap saya" off-CTA |
| Classic BM hard-sell (new seed) | RAHSIA / TERBONGKAR / AJAIB / TERBAIK DI DUNIA / SANGAT HEBAT / LUAR BIASA; "saya nak berkongsi…" opener; "Adakah anda / Tahukah anda / Korang tahu…" FB-ad question openers; "harga istimewa / tawaran terhad / slalu RM\d+ sekarang RM" price-discount framing |
| Persona-opener bans (migration 010) | "Korang pernah tak…", "Siapa kat sini…", "Jom / Jangan lepaskan / Save dulu / Share", "Thread/Post kali ini", "Hai semua / Assalammualaikum semua / Hi korang" |
| Psychology manipulative tactics (seed_techniques_psychology.sql) | Artificial scarcity ("stok terhad", "last chance", "cepat sebelum"), manufactured social proof ("1000 orang dah beli"), false authority ("pakar", "certified", "terbukti secara saintifik"), manipulative reciprocity ("ambil percuma", "claim sekarang"), aggressive empathy scripts ("saya faham sangat masalah anda") |

### Contested (bandit decides)

- `answer_first_question` (from seed_techniques_books) — Malay books say state the benefit
  immediately; the storytelling books say delay it.
- `question_then_gap` (from seed_techniques_books) — the most-taught device in headline books,
  and also the most exhausted on social feeds.
- `sold_count_proof` (from seed_techniques_books) — only works when the number is genuinely large.
- `niche_positioning` (from the 2026 seed) — Threads 2026 books argue hyper-specific
  person-targeting beats broad relatability; older storytelling books recommend universal
  relatability. Real engagement decides.
- `social_proof_subtle` (from seed_techniques_psychology) — "ramai tanya" vs explicit sold_count_proof numbers. The soft conversational version may work better in warm-up; the hard numerical version may work better once there's real sales volume.
- `belonging_signal` (from seed_techniques_psychology) — inclusive "kita" language vs hyper-specific niche_positioning. One says "we share this", the other says "you specifically". Different contexts may favor each.

Check the verdicts after ~6 cycles:

```sql
SELECT * FROM v_contested_verdicts;
```

New person-account levers added for 2026-style persona micro-posts (so the bandit can rotate through them):

| Kind | Code | Label |
|---|---|---|
| format | `rant_bite` | Rencana gigit — 1–2 line complaint/observation |
| format | `petua` | Satu petua — one small tip, no intro, no product name |
| angle  | `anti_tips` | Anti-petua — "Orang kata X. Salah. Ini yang bekerja." |
| angle  | `mundane` | Benda biasa — celebrates one tiny mundane thing, no teaching |
| tone   | `makcik` | Makcik bawang — long-winded, slightly nagging, with irrelevant-but-funny detail |

---

## 5. Headline-template packs (low signal, deliberately not mined)

Nine files are bulk "X headline templates" lists:

- `1359 Template Copywriting Headline Memukau.pdf`
- `21.101-Idea Headline.pdf`
- `29 Template Copywriting Headline Memukau.pdf`
- `50 template tajuk memikat.pdf`
- `800 Headline  Catchy.pdf`
- `97-templat-tajuk-memikat.pdf`
- `50 Ayat Iklan Promosi Cun.pdf`
- `Ayat-Jualan-Power-Shahmi-Hasifi-Waizu.pdf`
- `Him-Pun-an-88-Headline.pdf`

These were scanned for mechanisms but contributed mostly low-signal variations on the same
devices (curiosity gap + numbered lists + "X rahsia"). The few that weren't already covered by
existing techniques were the ones that led to the *bans* (the hard-sell language in §4).
Nothing new was added to the database from them. Uploading them to the KB will mine them more
deeply if you want, but don't expect a step-change in post quality.

---

## 6. Adding more books later

Two options.

**Option A — the KB web page.** Drag PDFs onto `https://kb.yourdomain.com`. Full automatic
pipeline with deduplication, so re-uploading the same book is harmless.

**Option B — bulk script.**
```bash
./scripts/ingest_books.sh https://kb.yourdomain.com
```

Both need an LLM endpoint configured. The seed SQL files exist because these techniques were
mined by hand (the sandbox environment in which this layer was built couldn't reach the live
KB stack).

**Whichever you use, review before new techniques consume posting slots:**

```sql
SELECT code, type, instruction FROM techniques WHERE n = 0 ORDER BY created_at DESC;
UPDATE techniques SET enabled = false WHERE code IN ('one_you_dislike');
```

A bad technique doesn't just make one bad post — it burns slots for a whole 3-day cycle before
the bandit can down-weight it.

---

## References & tool docs

**PDF handling**

- OCRmyPDF (for the 2 scanned/image-only PDFs): https://ocrmypdf.readthedocs.io/
- Tesseract `msa` (Malay) + `eng` language packs: https://tesseract-ocr.github.io/tessdoc/Data-Files
- pdfminer.six (Python library used for text-layer detection in this audit): https://pdfminersix.readthedocs.io/

**PostgreSQL features used by the seed files**

- POSIX regular expressions (used by banned-phrase rules): https://www.postgresql.org/docs/current/functions-matching.html#FUNCTIONS-POSIX-REGEXP
- Case-insensitive matching with `~*`: https://www.postgresql.org/docs/current/functions-matching.html#POSIX-MATCHING-METHODS
- JSONB (used for `concrete_details`, `sensory_details`, `enrichment`, `topic_context`): https://www.postgresql.org/docs/current/datatype-json.html

**Embeddings (similarity gate for the near-duplicate check)**

- OpenAI embeddings API: https://platform.openai.com/docs/api-reference/embeddings

**Threads 2026 algorithm context (cited by the 2026 books and strategy note)**

- Meta Threads API docs (rate limits, reply endpoints, content policies): https://developers.facebook.com/docs/threads
- Meta creator-reach best practices (authentic conversation, engagement ranking): https://developers.facebook.com/docs/threads/overview

**Psychology & communication theory (seed_techniques_psychology.sql)**

- Cialdini, Robert. *Influence, New and Expanded: The Psychology of Persuasion* (2021). Seven principles: reciprocity, liking, social proof, authority, scarcity, commitment/consistency, unity.
- Voss, Chris. *Never Split the Difference: Negotiating As If Your Life Depended On It* (2016). Tactical empathy, mirroring, calibrated questions, late-night FM DJ voice.
- Dhawan, Erica. *Digital Body Language: How to Build Trust and Connection, No Matter the Distance* (2021). Punctuation as tone, response time as priority signal, clarity over cleverness.
- Handley, Ann. *Everybody Writes: Your Go-To Guide to Creating Ridiculously Good Content* (2014, 2022). Conversational writing, one idea per sentence, cut ruthlessly.
- Carnegie, Dale (Associates). *How to Win Friends and Influence People in the Digital Age* (2011). Bury boomerangs, listen longer, leave others better.
- Bacon, Jono. *The Art of Community: Building the New Age of Participation* (2nd ed, 2014). Participation loops, belonging signals, community engagement patterns.
