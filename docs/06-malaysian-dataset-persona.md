# Malaysian-Dataset persona corpus

This is an optional layer for making ThreadsFlow sound more locally Malaysian without training a model.
It imports **small attributed snippets** from Malaysian-Dataset / Malaysian web crawls into Postgres and
feeds 1–3 snippets to the writer prompt as cadence references.

It is not a product-facts source. It must not be copied. It only teaches rhythm, sentence pressure,
register, and Malay phrasing.

## Licensing / usage caution

The Malaysian-Dataset docs mention non-commercial / original-owner constraints for many crawls. Since
ThreadsFlow is an affiliate system, treat this as opt-in after your own license review.

The importer therefore defaults to `usage_allowed=false`. Rows will not enter prompts unless you either:

1. import with `--usage-allowed` **and** `PERSONA_DATASET_ACK_NONCOMMERCIAL=1`, or
2. manually review and enable rows later with SQL.

Do not commit downloaded JSONL files to this repository.

## Schema

Migration:

```bash
psql "$DATABASE_URL" -f db/migrations/005_malay_persona_dataset.sql
```

Tables:

- `persona_sources` — dataset/source provenance and license notes.
- `persona_snippets` — short filtered Malay excerpts.
- `v_persona_snippets_for_prompt` — random enabled snippets for wf2.

## Import akuislam.com crawl

Example from the dataset the user suggested:

```bash
PERSONA_DATASET_ACK_NONCOMMERCIAL=1 \
npm --prefix services/kb run persona:import -- \
  --url https://huggingface.co/datasets/malaysia-ai/crawl-my-website/resolve/main/akuislam.com.jsonl \
  --slug akuislam \
  --limit 800 \
  --max-per-doc 2 \
  --usage-allowed
```

Safer review-first import:

```bash
npm --prefix services/kb run persona:import -- \
  --url https://huggingface.co/datasets/malaysia-ai/crawl-my-website/resolve/main/akuislam.com.jsonl \
  --slug akuislam \
  --limit 800 \
  --max-per-doc 2
```

Then inspect:

```sql
SELECT id, source_domain, register, left(text, 180) AS sample
FROM persona_snippets
WHERE source_domain='akuislam.com'
ORDER BY id DESC
LIMIT 30;
```

Enable only after review:

```sql
UPDATE persona_sources
SET usage_allowed=true
WHERE slug='akuislam';

UPDATE persona_snippets
SET usage_allowed=true
WHERE source_domain='akuislam.com'
  AND register IN ('reflective','conversational','informative');
```

## How wf2 uses it

`wf2_generate` now loads up to 24 snippets from `v_persona_snippets_for_prompt`.
The optional `n8n/code/persona_picker.js` node picks 1–3 snippets based on tone:

- `warm_sibling` → reflective / conversational
- `minimal`, `deadpan` → neutral / informative
- `gaul`, `chaotic` → conversational
- `corporate_parody` → formal / informative

The writer prompt includes this rule:

> These are NOT product facts and NOT templates. Borrow only rhythm, sentence pressure, and Malay
> register. Do not copy wording, claims, religious advice, or topic.

## Recommended sources

Start small. The goal is not to ingest the whole internet; the goal is to collect a few hundred
clean examples of Malaysian cadence.

Good first pass:

- `akuislam.com` — reflective Malay cadence; useful for warm/nasihat tone, but do not copy religious claims.
- `amanz.my` — Malaysian tech/product wording; useful for informative and casual tech products.
- selected local lifestyle blogs — useful for household / family products.

Avoid as prompt examples unless manually cleaned:

- hard-news political sites
- medical/legal advice sites
- pages full of boilerplate, comments, or religious/legal rulings that could accidentally become claims
