# ThreadsFlow — Documentation Audit & Deploy-Readiness Refresh (optimized prompt)

> This is a **refresh** prompt, not a from-scratch audit prompt. The full audit has
> already run at least twice against `SuperDuperNoob/threadsflow_arena.AI` and its
> output lives in `docs/guide/`. Running the generic version again would silently
> redo settled work and drop the diff discipline already established. Use this
> version instead, and re-run it after any commit that touches schema, routes,
> workflows, config, or deploy scripts.
>
> **Last verified:** 2026-08-01 against current `main` (no commit hash available —
> checked via repo tarball, not `git log`). Result: file scope, migrations, credential
> inventory, and all 4 pre-existing open items unchanged. One new item found and
> added to §2 (item 5, `persona/*.ipynb`). This is a §5.2 prompt edit, not a §5.5
> steady-state pass — a future run should re-check with real git history once
> available for an exact commit range.

## 0. Baseline — read this before touching anything

- `docs/guide/README.md` — index + **living "Open Questions / Code Mismatches"
  list**, each entry stamped with the commit(s) it was last verified against.
- `docs/guide/00-audit-summary.md` — file-by-file Part A output.
- `docs/guide/01-credential-sourcing.md` — Part B credential inventory, Tier A/B/C.
- `docs/guide/02-preflight-checklist.md` — human-facing pre-flight checklist.
- `docs/guide/03-agent-readiness-gate.md` — copy-paste preflight gate script.
- `docs/guide/STEP0_GROUND_TRUTH.md` — prior ground-truth extraction notes.

Do not regenerate these from a blank slate. **Diff against them.** Every open item
already logged in `docs/guide/README.md` must be re-checked against current code and
either marked resolved (with the resolving commit/file) or carried forward — never
silently dropped.

## 1. Get the actual diff surface first

```bash
git log --oneline -20                     # what's landed since the last "Re-verified" stamp
git diff <last-verified-commit>..HEAD --stat
```

Anything outside the diff range that the last pass already covered does not need
re-deriving from zero — only re-check it if this pass finds a reason to doubt it
(e.g. a doc claim that contradicts something the diff touched).

## 2. Documentation audit — scope is fixed, not rediscovered each time

Scan for new `*.md` files first (`find . -name "*.md" -not -path "./.git/*"`) —
the last known-good set is 30 files:

```
AGENTS.md
README.md
Books/Threads_Affiliate_Marketing_2026_Strategies.md
docs/00-START-HERE.md            docs/01-architecture.md
docs/02-n8n-workflows.md         docs/03-setup-runbook.md
docs/04-technique-library.md     docs/05-books.md
docs/06-persona-warmup.md        docs/07-l4-reply-loop.md
docs/08-72h-canary.md            docs/09-wf6-l4-improvements.md
docs/10-malaysian-dataset.md     docs/11-quick-start.md
docs/12-text-variation.md        docs/13-review-queue.md
docs/14-agent-autonomous-deploy.md
docs/TEXT_VARIATION_SUMMARY.md
docs/guide/00-audit-summary.md   docs/guide/01-credential-sourcing.md
docs/guide/02-preflight-checklist.md
docs/guide/03-agent-readiness-gate.md
docs/guide/README.md             docs/guide/STEP0_GROUND_TRUTH.md
n8n/workflows/wf6_karma.spec.md
prompts/cta.md  prompts/editor.md  prompts/persona_writer.md
prompts/reply_assistant.md  prompts/technique_extractor.md  prompts/writer.md
```

Any file not on this list is new — audit it fully and add it to the list above in
`docs/guide/README.md`.

### Ground-truth sources for this repo specifically (cite file:line, not "the code")

| Dimension | Where to look |
|---|---|
| Schema / enums / constraints | `db/schema.sql`, `db/schema_kb.sql`, `db/schema_techniques.sql`, `db/migrations/001…022_*.sql` — **022 is current head**, check for new files above it |
| Media/data model | `posts.media_type` enum (currently 5 values, migration `020_video_mixed_carousel.sql`), `product_images.media_kind` |
| Workflow/automation logic | `n8n/workflows/wf0_token_refresh.json`, `wf2_generate.json`, `wf3_publish.json`, `wf4_evaluate.json`, `wf6_persona.json`, `wf6_karma_draft.json`, `wf7_l4_reply.json`, `n8n/code/*.js` (bandit, scorer, QA, slot planner, `text_variation.js`) |
| API routes / auth / settings | `services/kb/server.js` (esp. the `/api/config/system/:key` allowlist and per-key validation, `/api/products`, `/api/apify/status`), `services/kb/lib/*.js`, `services/redirector/server.js` |
| Web/UI surfaces | `services/kb/public/*.html` — `product.html`, `settings.html` (currently 6 tabs: LLM, posting, bandit, qa, l4_reply, warmup, + scoring) |
| Deploy/infra | `infra/docker-compose.yml`, `infra/.env.example`, `scripts/setup_new_vps.sh`, `scripts/update_existing_vps.sh`, `scripts/bootstrap_n8n.sh`, `scripts/set_secrets.sh`, `scripts/init_db.sh`, `scripts/configure_llm.sh`, `scripts/observe_72h.sh`, `scripts/import_malaysian_datasets.sh`, `scripts/refresh_persona_topics.sh` |
| Persona dataset source material | `persona/*.ipynb` — notebooks, not referenced by any script or doc yet; watch for whether a future `import_malaysian_datasets.sh` change or `docs/10-malaysian-dataset.md` rewrite starts sourcing from these instead of/alongside HuggingFace |

### Known live open items (do not re-derive — verify status, then update)

As of the last "Re-verified" stamp in `docs/guide/README.md`, these were still open.
For each, check whether the referenced commit range changed it; if not, restate it
unchanged with today's date appended to the verification stamp:

1. Video/mixed publishing not wired into `wf3_publish.json` (no video/mixed branches,
   `video_url` param, or async status poll before `threads_publish`) despite migration
   020 + `bandit.js` supporting `VIDEO`/`MIXED_CAROUSEL`.
2. `services/kb/public/product.html` still browser-upload JPG/PNG only, capped at 4
   images, though `POST /api/products` accepts JPG/PNG/WebP/MP4/MOV.
3. `wf7_l4_reply.json` reads local `threads_comments` but has no ingestion path that
   populates it from Threads itself.
4. Migration `015_text_variation_settings.sql` + `n8n/code/text_variation.js` exist but
   no current workflow JSON calls the helper or logs `text_variations`.
5. **New this pass:** `persona/*.ipynb` (9 notebooks, `dataset-2` … `dataset-10`) appeared
   in the tree with no reference from any script or doc. `docs/10-malaysian-dataset.md`
   only documents the older, already-deleted `persona/dataset-1.json`. Not a doc/code
   contradiction (nothing claims the directory is empty) — flag as an unverifiable
   Open Question rather than guess at what it feeds, until a script or doc actually
   references it.

Treat resolved items (already marked `~~...~~ — RESOLVED` in `docs/guide/README.md`)
as closed unless this pass finds a regression — call that out explicitly if so.

### Output

Update `docs/guide/00-audit-summary.md` and `docs/guide/README.md` in place. Keep
the existing "Audit date / Re-verified" stamp format and append a new stamp with
the commit range this pass covered. Every file gets a line — "no changes required"
files are stated, not omitted.

## 3. Deploy-readiness tiering — reuse the existing Tier A/B/C table, don't reinvent it

`docs/guide/01-credential-sourcing.md` already has the authoritative table. Re-run
Step 1–2 of the original audit only to check for **new** setup actions introduced
since the last pass (new env vars in `infra/.env.example`, new flags in
`scripts/set_secrets.sh`, new services in `infra/docker-compose.yml`). Known
inventory as of the last pass, for reference (do not re-justify these from
scratch — only re-verify if the diff touches them):

**Tier A (agent-generated, no external account):** `PG_PASSWORD`, `DATABASE_URL`,
`N8N_ENCRYPTION_KEY`, `N8N_USER`/`N8N_PASSWORD`, `KB_PASSWORD`, `IP_SALT` — all
generated/placed by `scripts/setup_new_vps.sh`.

**Tier B/C (human-sourced):** VPS + SSH root access (C — billing/account),
domain + Cloudflare DNS zone (C), `CF_TUNNEL_TOKEN` (C for account, B once zone
exists), Cloudflare R2 + `S3_*` keys (B/C), LLM provider key `LLM_API_KEY` (C for
account/billing, B once key exists), **Threads long-lived token + user id** (C —
Meta App Review / tester-invite / consent boundary, hard gate, agent must never
attempt), Shopee Affiliate Open API `SHOPEE_API_APP_ID`/`SHOPEE_API_SECRET`
(C — affiliate approval, optional feature), Perplexity API key (C — optional,
account/billing), Apify token (C — optional, account/billing).

If the diff adds a new external call (`grep -rn "process.env\." services/ scripts/`
against the previous pass's list is the fast check), classify it the same way and
append a row — do not restructure the existing table.

### Output

Update `docs/guide/01-credential-sourcing.md`, `docs/guide/02-preflight-checklist.md`,
and `docs/guide/03-agent-readiness-gate.md` in place, only where the diff actually
changes an action, a file:line reference, or a required key. Keep `.env`/DB-key
placement instructions exact — that's what `scripts/set_secrets.sh` and the
readiness gate script consume.

## 4. Git workflow — commit + PR after each successful fix

Do not batch every fix from the whole pass into one end-of-run commit. Per fix:

1. **One fix = one commit**, made immediately after that fix is applied *and*
   validated (markdown/links/tables still parse, code reference confirmed) —
   not deferred to the end of the pass.
2. **Branch once per refresh run**, not per fix: `docs-audit/refresh-YYYY-MM-DD`
   (or `-2` etc. if a same-day second pass is needed). All fixes from this pass
   land as separate commits on that one branch.
3. **Commit message format**, mirroring the "Updated" line style already used in
   `docs/guide/00-audit-summary.md`:
   ```
   docs(<file>): <what changed>

   <one line: code reference this is now traceable to>
   ```
   e.g. `docs(product.html): note browser upload still JPG/PNG-only vs backend
   WebP/MP4/MOV support` / `services/kb/public/product.html`, `services/kb/server.js:/api/products`.
4. **If a fix fails validation** (broken link, malformed table, code reference
   doesn't actually check out), do not commit it — resolve it first. A failed
   fix never reaches `git commit`.
5. **After the last fix in the pass**, push the branch and open the PR:
   ```bash
   git push -u origin docs-audit/refresh-YYYY-MM-DD
   gh pr create --base main \
     --title "Docs audit refresh: <commit range covered>" \
     --body "<one bullet per commit, each with its fix + code reference; list of open items resolved/persisted/regressed; note any docs/guide/04-refresh-prompt.md change and why; flag if this is the terminal/steady-state PR per §5.5>"
   ```
6. **Never commit secrets.** No real `.env` values, tokens, or credentials in any
   diff — including ones that look like realistic placeholders. `infra/.env.example`
   stays placeholder-only.
7. **Git push credentials are Tier B, not Tier A.** The agent consumes a
   repo-scoped token a human already created and placed (e.g. `GH_TOKEN` env var
   or an already-authenticated `gh` CLI session) — it must never generate,
   request elevated scope for, or self-provision that token. If no push
   credential is present, stop and report it as a missing Tier B item exactly
   like the credentials in `docs/guide/01-credential-sourcing.md` — do not fall
   back to committing without pushing and silently skip the PR step.

Add this as a preflight check alongside the ones in `docs/guide/03-agent-readiness-gate.md`:
confirm `git remote get-url origin` resolves, `git config user.name`/`user.email`
are set, and the current branch is not `main` before the first commit of the pass.

## 5. Self-update — this prompt lives in the repo and evolves with it

This file is not external tooling — it is a versioned artifact of the repo,
same as `docs/guide/`.

1. **Location:** commit it at `docs/guide/04-refresh-prompt.md`, and add it as
   entry 5 in the file list in `docs/guide/README.md`. Every PR this workflow
   opens includes it in the diff whenever it changed.
2. **What "optimize the prompt" means each run.** After Steps 2–4 complete
   successfully (fixes committed, PR opened), spend one more pass asking: did
   *this run* reveal anything that would make the *next* run faster or more
   accurate?
   - a file scope entry that's now stale/renamed → update the 30(±)-file list
   - a "known live open item" that got resolved → move it out of §2's list
     (it's already tracked in `docs/guide/README.md`; don't duplicate it here)
   - a new recurring ground-truth location (new service, new script) → add a
     row to the ground-truth table in §2
   - a credential/env var that's newly relevant → add it to §3's inventory
   - process friction (a step that had to be done manually because this
     prompt didn't cover it) → fold it in as a new numbered step
   If none of the above happened, the prompt doesn't change this run — that's
   the expected steady-state outcome, not a failure to find something to edit.
3. **Prompt edits are a diff, not a rewrite.** Use the same fix-by-fix
   discipline as §4: a prompt edit is its own commit (`prompt(refresh): <what
   and why>`) on the same run branch, included in the same PR as the doc/code
   fixes from this run — not a separate PR.
4. **Guardrails — never self-edit away:**
   - the Tier A/B/C definitions and the rule that Tier C actions are never
     attempted by the agent
   - the "never commit secrets" rule
   - the requirement to cite a file:line for every claim
   - the requirement that a failed-validation fix is never committed
   - the requirement to state "no changes required" explicitly rather than
     omit a file
   These are the safety/completeness invariants of the whole workflow; scope
   lists, tables, and process steps built on top of them can evolve, these
   can't.
5. **Convergence / stop condition — this is what "done" means.** Keep
   re-running the refresh (new branch, new PR, each including any prompt
   edit) until one full pass produces all three of:
   - zero documentation fixes (every file's claims already match code)
   - zero credential-table changes
   - zero prompt edits (§5.2 found nothing to fold in)
   That pass's PR is the terminal one — say so explicitly in its summary and
   in the PR description ("steady state: no further prompt/doc drift found").
   Don't keep opening PRs after convergence on the assumption there's always
   something to tune; a no-op pass confirming steady state is a valid, final
   result, not a signal to keep searching for changes to make.

## 6. Final output format

1. **Refresh summary** — commit range covered, which of the 30 files changed and why,
   which open items resolved/persisted/regressed.
2. **Credential table delta** — only rows added/changed since the last pass (or "no
   change" if none).
3. **Updated Open Questions list** in `docs/guide/README.md`, same format as today
   (numbered, `~~struck~~ — RESOLVED` for closed items, new date stamp).
4. Anything genuinely new and unverifiable against code goes under a fresh "Open
   Questions" entry — never guessed into the docs.
5. **Prompt self-update note** — whether `docs/guide/04-refresh-prompt.md` changed
   this run, and why (or "no change — steady state" per §5.5).
6. **PR link** — the opened PR URL, the count of commits/fixes it contains, and
   whether this PR is the terminal (convergence) one per §5.5.
