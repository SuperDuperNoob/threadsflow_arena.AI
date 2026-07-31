# Malaysian Language Dataset — comprehensive persona snippet library

> 177 original Malaysian-style snippets across 9 domains, covering all registers
> and tones used by the persona warm-up and product post workflows.

---

## What happened

The original `persona/dataset-1.json` contained **7,340 entries that were 100% English**
("Applesauce!", "Balderdash!", etc.) — a generic NLP disagreement dataset with zero
Malaysian content. It was completely useless for persona calibration and has been **deleted**.

The Jupyter notebooks (`dataset-2.ipynb` through `dataset-10.ipynb`) are data collection
*scripts* that reference JSONL files not present in the repository. They are useful for
downloading and processing HuggingFace datasets but don't contain actual data.

**Migration 012** seeds the database with **177 original Malaysian-style snippets** that
capture authentic Malaysian cadence across all the domains and registers the system needs.

---

## What's in the database now

| Domain | Snippets | Register | Tones it serves |
|---|---|---|---|
| **facebook.com** | 31 | conversational | gaul, warm_sibling, makcik, chaotic |
| **iiumconfessions.com** | 15 | reflective | warm_sibling, reflective |
| **amanz.my** | 15 | informative | neutral, deadpan, enthusiast |
| **twitter.com** | 25 | neutral | deadpan, minimal |
| **lowyat.net** | 15 | conversational | gaul, chaotic |
| **mamak.my** | 15 | conversational | warm_sibling, gaul |
| **parenting.my** | 15 | reflective | warm_sibling, conversational |
| **commute.my** | 15 | conversational | deadpan, neutral, gaul |
| **work.my** | 15 | conversational | deadpan, neutral, gaul |
| **Total** | **177** | | |

### Coverage by register

| Register | Snippets | Description |
|---|---|---|
| `conversational` | ~100 | Casual BM, gaul, everyday speech |
| `reflective` | ~30 | IIUM-style, thoughtful, emotional |
| `informative` | ~15 | Tech reviews, how-to, factual |
| `neutral` | ~25 | Deadpan, short, punchy |
| `formal` | ~7 | News-style, structured |

### Coverage by tone

| Tone | Preferred registers | Domains |
|---|---|---|
| `deadpan` | neutral, informative | twitter, amanz |
| `gaul` | conversational | facebook, lowyat, mamak |
| `warm_sibling` | reflective, conversational | iium, facebook, mamak, parenting |
| `chaotic` | conversational | facebook, lowyat |
| `minimal` | neutral, informative | twitter, amanz |
| `makcik` | conversational, reflective | facebook (makcik style), iium |

---

## How snippets are used

1. **persona_picker.js** selects 3 snippets per post based on:
   - **Tone/register match** (3 points for matching register)
   - **Category/domain match** (up to 4 points for relevant product category)
   - **Time-of-day match** (1 point for time-relevant content)
   - **Tone-specific bonuses** (makcik prefers longer, deadpan prefers shorter)

2. Selected snippets are injected into the writer prompt as **calibration references**:
   ```
   ### Persona calibration — Malaysian cadence references
   These are NOT facts and NOT templates. Borrow only rhythm, sentence pressure,
   and Malay register. Do not copy wording, claims, religious advice, or topic.
   1. (conversational · facebook.com) Semalam try petua mak, letak daun pandan...
   2. (reflective · iiumconfessions.com) Aku kerja shift malam, balik subuh...
   3. (neutral · twitter.com) Monday blues memang real...
   ```

3. The LLM uses these as **rhythm/register references** — it borrows the cadence
   and sentence structure but writes original content about the assigned topic.

---

## Adding more snippets from HuggingFace

The `persona_dataset.mjs` importer can pull real Malaysian text from HuggingFace:

```bash
# Run the import script
./scripts/import_malaysian_datasets.sh postgresql://threadsflow:password@localhost:5432/threadsflow
```

This downloads and imports from:
- **Facebook comments** (casual Malay) — `mesolitica/noisy-standard-malay-translation-instructions`
- **IIUM Confessions** (reflective Malay) — same dataset
- **Manglish/Lowyat** (Malaysian English) — same dataset
- **Amanz.my** (tech reviews) — `mesolitica/crawl-amanz-my`
- **Malaysian web crawls** — `malaysia-ai/crawl-my-website`

The importer:
- Filters for Malay language content (malayScore ≥ 4)
- Rejects Indonesian words (banget, nggak, bikin, etc.)
- Classifies register automatically (conversational, reflective, informative, formal, neutral)
- Tags with domain and register
- Deduplicates via SHA-256 hash
- Splits long documents into 120-700 char snippets

---

## Snippet quality rules

All snippets (seeded and imported) must pass:

| Rule | Why |
|---|---|
| 120-700 chars | Long enough for cadence, short enough for prompt |
| Malay score ≥ 4 | At least 4 common Malay words present |
| No Indonesian words | Blocks banget, nggak, bikin, gimana, etc. |
| No URLs/hashtags/mentions | Clean text only |
| No copyright notices | No "hak cipta", "all rights reserved" |
| SHA-256 unique | No duplicate snippets |

---

## How to verify your snippets

```sql
-- Count snippets by domain
SELECT source_domain, register, COUNT(*) AS snippets
FROM persona_snippets
WHERE enabled AND usage_allowed
GROUP BY source_domain, register
ORDER BY snippets DESC;

-- Sample snippets from each register
SELECT register, text
FROM persona_snippets
WHERE enabled AND usage_allowed
ORDER BY random()
LIMIT 5;

-- Check for Indonesian contamination
SELECT COUNT(*) AS indonesian_snippets
FROM persona_snippets
WHERE text ~* '\b(banget|nggak|gak|aja|udah|bikin|gimana|kalian|doang|cowok|cewek|gue)\b';
```

---

## Files changed

| File | What |
|---|---|
| `persona/dataset-1.json` | **Deleted** — 7,340 English entries, 0% Malaysian |
| `db/migrations/012_persona_malaysian_snippets.sql` | **New** — 177 Malaysian snippets across 9 domains |
| `n8n/code/persona_picker.js` | **Improved** — time-of-day, makcik tone, better scoring |
| `scripts/import_malaysian_datasets.sh` | **New** — downloads from HuggingFace |

---

## References

- Malaysian-Dataset (GitHub): https://github.com/malaysia-ai/malaysian-dataset
- Mesolitica HuggingFace: https://huggingface.co/mesolitica
- Malaysia-AI HuggingFace: https://huggingface.co/malaysia-ai
- Malaysian-Dataset docs: https://malaysian-dataset.readthedocs.io
- MaLLaM paper: https://arxiv.org/html/2401.14680v2
