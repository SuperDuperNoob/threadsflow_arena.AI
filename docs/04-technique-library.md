# Technique Library — mining your NotebookLM copywriting PDFs into the bandit

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
| **RAM** | Headless Chrome is 300–600MB resident, spiking higher. On your 4GB box with n8n at 1.4GB + Postgres + MinIO, that's the thing that OOM-kills your stack. |
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
you whether it's true for Indonesian Threads users buying a Rp 89k product.

Books written for 1980s US direct mail will be **wrong** for your audience about half the time.
The Technique Library plus the bandit is how you find out which half.

---

## 3. The schema

Added in `db/schema_techniques.sql`:

```sql
techniques           -- the atomic units: name, type, when_to_use, the actual instruction,
                     -- do/dont examples, source book, and live performance stats
technique_usage      -- join table: which techniques were in which post (for attribution)
technique_sources    -- which PDF/notebook each came from
mining_questions     -- the 30 questions, so the extraction is reproducible
```

The key column is `instruction` — a single imperative sentence the writer LLM can act on.
Not "Use the PAS framework" (too abstract, produces templates) but:

> *"Open by naming a physical sensation the reader has felt in the last 7 days, before naming
> any product category."*

**Atomic and behavioural.** If a technique can't be written as one imperative sentence, it's too
abstract to be a technique — break it into three that can.

---

## 4. The mining process (one afternoon, once)

### Step A — ask NotebookLM 30 questions, manually

Open your notebook in the browser. Paste each question from `db/mining_questions.sql`. Copy each
answer into a text file. This is 30 copy-pastes — genuinely faster than debugging headless Chrome
on a VPS, and you only do it once.

The questions are designed to extract *mechanisms*, not *summaries*. Examples:

- "List every specific technique in these sources for opening a piece of copy so the reader
  cannot stop. For each: the name, the psychological mechanism, and one concrete example."
- "What do these sources say makes copy sound fake, salesy, or untrustworthy? List every
  specific word, phrase pattern, or structure to avoid."
- "What techniques do these sources give for selling WITHOUT appearing to sell?"
- "Which techniques in these sources are specific to short-form social media rather than
  long-form sales letters?"
- "Where do these sources disagree with each other? What are the contested claims?"

That last one is gold. Contested claims become your highest-priority A/B tests — the bandit can
settle arguments the authors couldn't.

### Step B — structure with one LLM call per answer

`scripts/mine_techniques.mjs` takes the raw answers and emits `techniques` rows. The extraction
prompt is in `prompts/technique_extractor.md`. It forces:
- one imperative sentence per technique
- a type (`hook`, `structure`, `psychology`, `voice`, `cta`, `anti_pattern`, `proof`)
- a `compatible_with` array (which formats/tones/intensities it fits)
- concrete do/don't examples
- **rejection** of anything too vague to check

### Step C — route the output four ways

| Extracted type | Where it lands |
|---|---|
| `hook`, `structure` | new rows in `levers` (kind=`format`) → bandit tests them as full arms |
| `psychology`, `proof` | new rows in `levers` (kind=`angle`) |
| `voice` | new rows in `levers` (kind=`tone`) |
| `anti_pattern` | new rows in `banned_phrases` → enforced by the QA gate for free |
| `cta` | new rows in `cta_variants` |
| everything else | `techniques` table, injected as **devices** (see §5) |

So your PDFs don't just inform the copy — they **expand the search space** the bandit explores.
You might go from 12 formats to 25, from 9 angles to 20. Search space grows to ~50k combos, which
is fine because the learner works on marginals, not combos.

---

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

Then `technique_usage` records which devices were in which post, and the same z-scored cycle
scoring that rates your tones also rates your techniques. After ~6 cycles you'll see rows like:

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
of those agents at the MCP server on your laptop, have it run the 30 mining questions, and write
`techniques.json`. Then `scripts/import_techniques.mjs` loads it into Postgres. Zero browser on
the VPS, full automation of the boring part.

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
   from 1980s American direct mail into casual Indonesian Threads posts produces exactly the
   uncanny, over-written voice you're trying to avoid.

And the thing worth repeating: **your click and conversion data will eventually be more valuable
than every PDF combined.** The books are a prior. Your bandit is the posterior. Treat the library
as a way to generate good hypotheses cheaply, not as a source of truth.
