# Technique Library — turning copywriting PDFs into testable bandit arms

Short answer to your question: **yes to extraction, no to live MCP calls in the posting loop.**
Do it once (well), store it as structured data, and let the bandit optimize it. Here's why, then
the how.

---

## 1. Why NOT to call NotebookLM at generation time

You asked about connecting NotebookLM via MCP so the generator pulls from it every time. It's
technically possible, but it's the wrong architecture for this system. Six reasons:

| Problem | Detail |
|---|---|
| **No official API** | Google has never shipped a public NotebookLM API. Every MCP server (`notebooklm-mcp`, `notebooklm-mcp-cli`, `notebooklm-mcp-2026`) drives a **real Chrome browser** via Patchright/Playwright and scrapes the DOM. |
| **RAM** | Headless Chrome is 300–600MB resident, spiking higher. On your 4GB box with n8n at 1.4GB + Postgres + kb service, that's the thing that OOM-kills your stack. |
| **Latency** | A NotebookLM query is 15–60s. Your generator makes 5 posts × 3 calls nightly. You'd add minutes and a new failure mode for zero benefit. |
| **Auth fragility** | Session cookies expire in 2–4 weeks. Your posting pipeline would silently break every month until you re-login through a browser — on a headless VPS, that means `xvfb-run` gymnastics. |
| **ToS / ban risk** | Browser automation against a Google product from a datacenter IP. Not something to put in a daily cron. |
| **It doesn't help anyway** | This is the real reason. See below. |

**The "it doesn't help" argument matters most.** Your copywriting PDFs contain a *fixed, finite*
set of knowledge. Gary Halbert's principles don't change between Tuesday and Wednesday. Querying
them fresh 1,825 times a year returns near-identical text every time — you'd pay latency, RAM,
and fragility to re-download a constant.

Worse: RAG at generation time actively *causes* the templating problem you told me to avoid. If
every post retrieves "the top 3 chunks about persuasion," every post converges on the same 3
chunks. You'd build a machine that reliably reproduces the same 5 formulas — the exact failure
mode you're trying to escape.

---

## 2. What to do instead: extract once, structure it, let the bandit optimize

```
NotebookLM (your PDFs)
        │  ONE-TIME, run manually, ~2 hours of your time
        ▼
  30 mining questions  ──►  raw answers  ──►  LLM structuring pass
        │
        ▼
  techniques table        ~80–150 rows, each an atomic, applicable technique
        │
        ├──► becomes new LEVER VALUES (formats/angles you didn't think of)
        ├──► becomes DEVICES injected into the writer prompt (1–2 per post, rotated)
        ├──► becomes new BANNED PHRASES (what the books say NOT to do)
        └──► becomes QA RULES (checkable constraints, e.g. "one idea per sentence")
        │
        ▼
  the bandit measures which techniques actually earn money on YOUR account
```

The last line is the payoff. A PDF telling you "urgency converts" is an *untested hypothesis*.
Your system already has the machinery to test hypotheses against real Shopee commissions. So the
right move is: turn each book's claim into a **testable arm**, then let 15 posts per cycle tell
you whether it's true for Malaysian Threads users buying an RM39 product.

Books written for 1980s US direct mail — or 2015 Facebook ads — will be **wrong** for your
audience about half the time.
The Technique Library plus the bandit is how you find out which half.

---

## 3. The schema

Added in `db/schema_techniques.sql` and `db/schema_kb.sql`:

```text
techniques           -- the atomic units: name, type, when_to_use, the actual instruction,
                     -- do/dont examples, source book, and live performance stats
technique_usage      -- join table: which techniques were in which post (for attribution)
technique_sources    -- which PDF/notebook each came from
mining_questions     -- the 30 questions, so the extraction is reproducible
kb_documents         -- uploaded PDFs, 3-level dedup, ingestion status
kb_candidates        -- staging: every extraction lands here before touching the live library
```

The key column is `instruction` — a single imperative sentence the writer LLM can act on.
Not "Use the PAS framework" (too abstract, produces templates) but:

> *"Open by naming a physical sensation the reader has felt in the last 7 days, before naming
> any product category."*

**Atomic and behavioural.** If a technique can't be written as one imperative sentence, it's too
abstract to be a technique — break it into three that can.

---

## 4. Filling the library

> **Your `Books/` folder is already done.** 26 PDFs were mined into 17 techniques (60 total in
> the library). Read `docs/05-books.md` for what was extracted, what was rejected as harmful,
> and which 3 PDFs need OCR. This section is for adding *more* books later.

### Way 1 (recommended): drop PDFs into the Knowledge Base — already built

Open `https://kb.yourdomain.com`, drag your copywriting PDFs onto the page, done. The KB service
(`services/kb/`) handles everything:

```
upload → 3-level dedup → extract text → chunk & score → mine → validate → dedup vs library
       → merge or insert → promote anti-patterns to banned_phrases, hooks/structures to levers
```

You do not run a script, do not answer 30 questions by hand, and do not touch NotebookLM.
Progress streams into the UI; a 300-page book takes a few minutes and peaks at ~88 MB RAM.

Dedup runs at three levels so re-uploading is always safe:
1. **file sha256** — identical bytes, rejected instantly at upload
2. **text sha256** — same text, different file (re-export, different scanner)
3. **simhash ≤ 6** — near-duplicate, e.g. a second edition or another scan

Then at the technique level, embeddings decide per candidate:
- **≥ 0.90 similarity and same type** → merge, and `corroboration` increments (a claim two books
  make independently is a stronger prior than one book asserting it)
- **0.83–0.90** → parked in the **Review** tab for you to judge
- **< 0.83** → inserted as new

Type equality is a hard gate on merging. Embeddings place *"state a measurable drawback"* and
*"name a physical sensation"* very close — both are short imperative sentences about the reader —
but they are different techniques, and merging them silently destroys a good row. This was a real
bug caught in testing.

**Scanned PDFs are rejected** with a clear message rather than mined into garbage. Run them
through `ocrmypdf` first — for Malay material use both language packs:

```bash
ocrmypdf -l msa+eng "Books/scanned.pdf" "Books/scanned.ocr.pdf"
```

**The chunk scorer understands Malay as well as English.** This matters more than it sounds: the
scorer decides which pages are worth sending to the LLM, and the original English-only version
rated Malay books near zero and skipped them almost entirely. Measured on the real `Books/`
folder, teaching it Malay signal words (`teknik`, `tajuk`, `jangan`, `sebab`, `pelanggan`,
`contoh`) and numbered-list detection took the yield from 284 to 465 usable chunks — and one
book from 6 chunks to 63. If you add books in another language, extend `SIGNAL` in
`services/kb/lib/pdf.js` or the same silent-skip will happen again.

**Bulk upload** for a whole folder at once:

```bash
./scripts/ingest_books.sh https://kb.yourdomain.com
```

### Way 2 (optional): NotebookLM for things that aren't PDFs

If your material lives in NotebookLM as web pages, YouTube transcripts, or Google Docs rather
than files, ask it the 30 questions in `db/mining_questions.sql`, paste each answer into a text
file, and upload that as a `.pdf` (or paste into the description of a source). The same pipeline
processes it.

Keep the NotebookLM MCP server on your **laptop**, never the VPS — see §6. And re-mine every
2–3 months, not daily. There is nothing daily about a book.

### Either way: review before it costs you posting slots

```sql
SELECT code, type, instruction FROM techniques WHERE array_length(document_ids,1) > 0;
```

Read them. Disable anything that would sound wrong in your voice:

```sql
UPDATE techniques SET enabled = false WHERE code IN ('x','y');
```

A bad technique doesn't just make one bad post — it burns posting slots for a whole cycle before
the bandit can down-weight it. The UI has a toggle per technique for exactly this.

## 5. Devices: how techniques enter a post without templating it

Each generation picks **1–2 techniques** (Thompson-sampled, same as levers) and injects them as
constraints, not as a formula:

```
### Craft constraints for this post (apply invisibly — never name them)
- {{technique_1.instruction}}
  Do: {{technique_1.example_do}}
  Never: {{technique_1.example_dont}}
- {{technique_2.instruction}}
```

Two rules keep this from collapsing back into templates:

1. **Max 2 devices per post.** Three or more and the LLM starts producing a checklist-shaped
   post that reads mechanical. Two is the sweet spot — enough to shape it, not enough to define it.
2. **`compatible_with` gating.** A technique tagged `["deadpan","minimal"]` never fires on an
   `enthusiast` post. Mismatched device + tone is the #1 source of copy that feels "off".

Then `technique_usage` records which devices were in which post, and the same Bayesian-shrunk
cycle scoring that rates your tones also rates your techniques. After ~6 cycles you'll see rows like:

```
technique                              n    mean_reward   lift
sensory_open (Halbert)                14      0.71       +0.24
specific_number_over_round (Ogilvy)   11      0.68       +0.21
future_pacing (Sugarman)               9      0.44       -0.03
urgency_deadline (Kennedy)            12      0.29       -0.18   ← cooled down
```

You just empirically falsified a famous copywriter's advice for your specific niche. That's worth
more than the PDF was.

---

## 6. If you still want the MCP connection

Fine — but put it in the **right place**: a manual, on-demand refresh, never the hot path.

```
UI button "Re-mine Technique Library"
   → n8n wf6_mine (manual trigger only)
   → HTTP call to a NotebookLM MCP bridge running on your laptop (NOT the VPS)
   → structure + upsert into techniques
```

Run the MCP server on your **laptop**, where Chrome and a display already exist, and expose a
tiny HTTP endpoint that n8n calls. Your VPS never runs a browser. Practical options:

- `jacob-bd/notebooklm-mcp-cli` — most complete; has `nlm notebook query` CLI, so you can skip
  MCP entirely and just script the CLI into a JSON file, then upload that file to the UI.
- `julianoczkowski/notebooklm-mcp-2026` — stdio, 9 tools, cookie auth via Chrome DevTools.
- `PleasePrompto/notebooklm-mcp` — Patchright-based, most installed.

Since you already have **Antigravity and Codex** on the box, the cleanest version is: point one
of those agents at the MCP server on your laptop, have it run the 30 mining questions, and save
the answers as a text file. Upload that file through the KB web UI like any other document —
the same dedup, validation and merge pipeline applies. Zero browser on the VPS.

**Re-mine cadence: every 2–3 months, or when you add new PDFs.** Not daily. There is nothing
daily about a book.

---

## 7. Honest assessment of the value

Let me be straight about what this buys you, in order:

1. **Biggest win: the anti-pattern list.** The "what makes copy sound salesy" extraction feeds
   `banned_phrases`, which is enforced mechanically on every post forever. This alone justifies
   the afternoon.
2. **Second: new lever values.** More formats/angles than you'd invent alone = a wider space for
   the bandit to find something that works.
3. **Third: devices.** Real but modest. Good copywriting books mostly encode things a strong LLM
   already knows. The lift comes from *specificity and enforcement*, not novelty.
4. **Smallest: the prose itself.** Do not paste chunks of the books into prompts. Style transfer
   from 1980s American direct mail into casual Malaysian Threads posts produces exactly the
   uncanny, over-written voice you're trying to avoid.

And the thing worth repeating: **your click and conversion data will eventually be more valuable
than every PDF combined.** The books are a prior. Your bandit is the posterior. Treat the library
as a way to generate good hypotheses cheaply, not as a source of truth.

---

## References & official docs

This page is design commentary rather than an integration guide, but the tools it recommends
are documented here:

**PDF / text processing used by the KB ingestion pipeline**

- `pdf-parse` (the library we use for text extraction): https://www.npmjs.com/package/pdf-parse
- Mozilla PDF.js (what `pdf-parse` wraps; used as fallback for problematic PDFs): https://mozilla.github.io/pdf.js/
- OCRmyPDF (recommended for scanned / image-only PDFs, supports Malay via `-l msa+eng`): https://ocrmypdf.readthedocs.io/
- Tesseract language packs (`msa` for Malay, `eng` for English) used by OCRmyPDF: https://tesseract-ocr.github.io/tessdoc/Data-Files

**Embeddings and similarity**

- OpenAI embeddings API (default `text-embedding-3-small`): https://platform.openai.com/docs/api-reference/embeddings
- Cosine similarity (the 0.86 threshold and the anti-repeat logic): https://en.wikipedia.org/wiki/Cosine_similarity

**Multi-armed bandit / Thompson sampling**

- Thompson sampling original paper (Russo et al. tutorial): https://web.stanford.edu/~bvr/pubs/TS_Tutorial.pdf
- A friendly introduction: https://lilianweng.github.io/posts/2018-01-23-multi-armed-bandit/
- SimHash for near-duplicate detection (the ≤6-bit Hamming gate for PDF dedup): https://en.wikipedia.org/wiki/SimHash

**LLM chat completions**

- OpenAI Chat Completions API (shape all our `/chat/completions` calls follow, regardless of provider): https://platform.openai.com/docs/api-reference/chat
