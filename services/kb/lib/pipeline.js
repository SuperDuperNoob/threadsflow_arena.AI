/**
 * The ingestion pipeline. One PDF in → validated, deduped techniques in the live library.
 *
 *   1. fingerprint  → three-level dedup, exit early if we've seen this book
 *   2. extract      → text per page, reject scans
 *   3. chunk        → ~6k char chunks, scored, top N mined
 *   4. mine         → LLM extracts candidate techniques per chunk
 *   5. validate     → mechanical rejection of vague/unexecutable output
 *   6. dedup+merge  → embedding similarity against the existing library
 *   7. promote      → anti-patterns → banned_phrases, hooks/structures → levers
 *
 * Every step writes progress to kb_documents so the UI can show a live bar.
 */

import fs from 'node:fs/promises';
import {
  extractPdf, cleanText, stripBoilerplate, chunk, scoreChunk,
  simhash, hamming, sha256,
} from './pdf.js';
import { complete, embed, cosine, mapLimit } from './llm.js';

const MINE_CONCURRENCY = Number(process.env.MINE_CONCURRENCY ?? 2);
const MAX_CHUNKS = Number(process.env.MAX_CHUNKS_PER_DOC ?? 45);
const MERGE_THRESHOLD = Number(process.env.MERGE_THRESHOLD ?? 0.90);
const REVIEW_THRESHOLD = Number(process.env.REVIEW_THRESHOLD ?? 0.83);

// ─────────────────────────────────────────── validation
// Same rules as scripts/mine_techniques.mjs. Kept here so the service is self-contained.

const ABSTRACT = /^(use|apply|employ|leverage|utili[sz]e|consider|remember|understand|ensure|try to|focus on|be\s+(more\s+)?(specific|clear|concise|authentic|human|relatable|persuasive|compelling))\b/i;
const TYPES = ['hook', 'structure', 'psychology', 'voice', 'cta', 'anti_pattern', 'proof', 'rhythm'];
const FORMATS = ['flash_story','confession','pov','chat_narration','list_of_three','one_liner',
                 'honest_review','diary','myth_bust','overheard','before_after','question_hook'];
const TONES = ['deadpan','gaul','warm_sibling','corporate_parody','chaotic','minimal','enthusiast'];

export function validate(t) {
  const p = [];
  if (!t.code || !/^[a-z][a-z0-9_]{2,48}$/.test(t.code)) p.push('bad code');
  if (!TYPES.includes(t.type)) p.push(`bad type: ${t.type}`);

  const ins = (t.instruction ?? '').trim();
  if (ins.length < 25) p.push('instruction too short');
  if (ins.length > 260) p.push('instruction too long — not atomic');
  if (ABSTRACT.test(ins)) p.push('abstract, not executable');
  if (ins.split(/\s+and\s+/i).length > 2) p.push('two actions in one — should be split');
  if (/\b(framework|principle|concept)\b/i.test(ins) && !/\b(open|write|name|state|end|start|use the word)\b/i.test(ins)) {
    p.push('names a concept instead of an action');
  }
  if (!t.example_do || t.example_do.length < 10) p.push('missing example_do');
  if (!t.example_dont || t.example_dont.length < 10) p.push('missing example_dont');
  if (t.example_do && t.example_dont && t.example_do === t.example_dont) p.push('examples identical');

  if (t.regex) { try { new RegExp(t.regex, 'iu'); } catch { p.push('invalid regex'); } }
  // an over-broad regex would silently reject every post you ever generate
  if (t.regex && /^\W*\.\*|^\W*\.\+|^\(\?:\)?\W*$/.test(t.regex)) p.push('regex too broad');
  if (t.regex && t.regex.length < 4) p.push('regex too broad');

  for (const f of t.compatible_formats ?? []) if (!FORMATS.includes(f)) p.push(`unknown format ${f}`);
  for (const x of t.compatible_tones ?? []) if (!TONES.includes(x)) p.push(`unknown tone ${x}`);

  return p;
}

// ─────────────────────────────────────────── prompts

const MINER_SYSTEM = `You convert copywriting theory into machine-executable constraints.

Your output feeds an automated system that writes short Indonesian social-media posts (Threads,
under 500 characters) selling Shopee affiliate products. Each technique you emit will be injected
into a writing prompt as a constraint, and its real-world performance will be measured against
clicks and sales.

THE GOVERNING RULE: a technique must be executable by a writer who has never read this book.

  REJECT: "Use the PAS framework"          — abstract, produces formulaic output
  REJECT: "Be specific"                    — not checkable
  REJECT: "Build rapport with the reader"  — not an action
  ACCEPT: "Name a physical sensation the reader felt in the last 7 days before naming any product category."
  ACCEPT: "State one measurable drawback using a real number before any benefit."
  ACCEPT: "End mid-thought, without resolving the situation you opened with."

If a passage is too abstract, either decompose it into 2-4 concrete techniques that pass, or drop
it. Dropping is correct and expected. Most pages of most books contain zero extractable techniques
— returning an empty array is a valid, good answer. Do not invent techniques to fill space.

RULES
1. One idea per technique. If "instruction" joins two actions with "and", split it.
2. Examples must be casual Indonesian, about a cheap consumer product, under 500 chars.
   Never copy 1980s American direct-mail prose — adapt the underlying mechanism.
3. "example_dont" must be a NEAR-MISS that is subtly wrong, not an obvious failure.
4. Be honest about compatible_formats / compatible_tones. Empty array = universal; use sparingly.
5. Set contested=true if the passage argues against another common view, or asserts without evidence.
6. For type "anti_pattern" also emit "regex": a specific case-insensitive regex detecting the
   violation in Indonesian or English text. If you cannot write a SPECIFIC regex, use a different
   type instead. Never emit a broad catch-all regex.
7. Reject anything that only works in print/direct-mail/TV and would backfire on a hostile
   modern social feed.
8. "quote": copy the single most relevant sentence from the source verbatim, for verification.
9. Output ONLY valid JSON.

compatible_formats options: ${FORMATS.join(', ')}
compatible_tones options: ${TONES.join(', ')}

SCHEMA
{"techniques":[{"code":"snake_case","name":"","type":"hook|structure|psychology|voice|cta|anti_pattern|proof|rhythm",
"instruction":"","when_to_use":"","mechanism":"","example_do":"","example_dont":"",
"compatible_formats":[],"compatible_tones":[],"compatible_intensity":[0,1,2],
"contested":false,"contested_note":null,"regex":null,"quote":""}]}`;

const MERGE_SYSTEM = `You merge two descriptions of the same copywriting technique into one.

You will get an EXISTING technique already in a library, and a NEW one extracted from a different
book that means substantially the same thing. Produce a single improved version.

Rules:
- Keep the existing "code" unchanged. Other systems reference it.
- Choose whichever "instruction" is more concrete and more executable. If the new one adds a
  specific detail (a number, a position, a constraint), incorporate it.
- Keep the better pair of examples; you may take example_do from one and example_dont from the other.
- Union the compatible_* arrays only if both sources genuinely support the wider range;
  otherwise keep the narrower one. Narrow is safer than wide.
- If the two sources DISAGREE about how or when to apply it, set contested=true and explain the
  disagreement in contested_note. This is valuable — do not smooth it over.
Output ONLY JSON with the same schema as the input technique.`;

// ─────────────────────────────────────────── pipeline

export async function runIngest({ db, documentId, log = console.log }) {
  const setStatus = async (status, progress, note) => {
    await db.query(
      `UPDATE kb_documents SET status=$2, progress=$3, stage_note=$4 WHERE id=$1`,
      [documentId, status, progress, note ?? null]);
  };

  const { rows: [doc] } = await db.query(`SELECT * FROM kb_documents WHERE id=$1`, [documentId]);
  if (!doc) throw new Error('document not found');

  const buf = await fs.readFile(doc.storage_path);

  // ── 1. extract
  await setStatus('extracting', 0.05, 'reading PDF');
  const parsed = await extractPdf(buf);

  if (parsed.likelyScanned) {
    await db.query(
      `UPDATE kb_documents SET status='rejected', error=$2, finished_at=now() WHERE id=$1`,
      [documentId, 'Scanned/image PDF — no extractable text layer. OCR it first (e.g. ocrmypdf) and re-upload.']);
    return { status: 'rejected', reason: 'scanned' };
  }

  const pages = stripBoilerplate(parsed.pages);
  const fullText = cleanText(pages.map(p => p.text).join('\n\n'));
  const textHash = sha256(Buffer.from(fullText));
  const sim = simhash(fullText);

  // ── 2. dedup levels 2 and 3 (level 1, file sha256, was checked at upload)
  await setStatus('extracting', 0.12, 'checking for duplicates');
  const { rows: existing } = await db.query(
    `SELECT id, filename, title, text_sha256, simhash FROM kb_documents
      WHERE id <> $1 AND status IN ('done','mining','merging')`, [documentId]);

  for (const e of existing) {
    if (e.text_sha256 && e.text_sha256 === textHash) {
      await db.query(
        `UPDATE kb_documents SET status='duplicate', duplicate_of=$2, finished_at=now(),
                error=$3 WHERE id=$1`,
        [documentId, e.id, `Identical text to "${e.title || e.filename}" (different file, same content)`]);
      return { status: 'duplicate', of: e.id };
    }
    if (e.simhash != null && hamming(sim, e.simhash) <= 6) {
      await db.query(
        `UPDATE kb_documents SET status='duplicate', duplicate_of=$2, finished_at=now(),
                error=$3 WHERE id=$1`,
        [documentId, e.id, `Near-duplicate of "${e.title || e.filename}" (different edition or scan)`]);
      return { status: 'duplicate', of: e.id };
    }
  }

  // ── 3. title detection
  let title = parsed.meta.title;
  let author = parsed.meta.author;
  if (!title || title.length < 3 || /^(untitled|microsoft word|document)/i.test(title)) {
    try {
      const guess = await complete(
        'Identify the book or document from its opening text. Output JSON {"title":"","author":""}. If unsure, use null.',
        fullText.slice(0, 3000), { temperature: 0 });
      title = guess.title || doc.filename.replace(/\.pdf$/i, '');
      author = author || guess.author || null;
    } catch { title = doc.filename.replace(/\.pdf$/i, ''); }
  }

  await db.query(
    `UPDATE kb_documents SET title=$2, author=$3, pages=$4, char_count=$5,
            text_sha256=$6, simhash=$7 WHERE id=$1`,
    [documentId, title, author, parsed.meta.pageCount, fullText.length, textHash, sim.toString()]);

  // ── 4. chunk + score + select
  await setStatus('chunking', 0.18, 'splitting into chunks');
  const allChunks = chunk(pages);

  // skip chunks already seen in another document (shared appendices, quoted excerpts)
  const hashes = allChunks.map(c => c.sha256);
  const { rows: seen } = await db.query(
    `SELECT DISTINCT sha256 FROM kb_chunks WHERE sha256 = ANY($1) AND document_id <> $2`,
    [hashes, documentId]);
  const seenSet = new Set(seen.map(r => r.sha256));

  // Cross-document chunk dedup skips passages we've already mined from another book
  // (shared appendices, quoted excerpts). But it must never be allowed to empty the
  // document: a short book whose every chunk was seen elsewhere would silently yield
  // nothing. If dedup removes everything, keep the originals and let technique-level
  // dedup handle the overlap instead.
  const fresh = allChunks.filter(c => !seenSet.has(c.sha256));
  const pool = fresh.length ? fresh : allChunks;

  const scored = pool
    .map(c => ({ ...c, score: scoreChunk(c.text) }))
    .sort((a, b) => b.score - a.score);

  // Mine the top chunks only. A 300-page book yields ~90 chunks; the bottom two-thirds are
  // biography, anecdote and front matter. Mining them costs money and returns noise.
  const selected = scored.filter(c => c.score >= 3).slice(0, MAX_CHUNKS);
  // Always mine at least something — a small or unusually-worded book can score low
  // everywhere, and returning zero techniques with status 'done' looks like success.
  const toMine = selected.length >= 5
    ? selected
    : scored.slice(0, Math.min(15, scored.length));

  for (const c of allChunks) {
    await db.query(
      `INSERT INTO kb_chunks (document_id, ord, page_from, page_to, text, char_count, sha256, mined)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (document_id, ord) DO NOTHING`,
      [documentId, c.ord, c.page_from, c.page_to, c.text, c.text.length, c.sha256,
       toMine.some(m => m.ord === c.ord)]);
  }
  log(`  ${allChunks.length} chunks, mining ${toMine.length}`);

  // ── 5. mine
  await setStatus('mining', 0.25, `mining ${toMine.length} chunks`);
  let done = 0;
  const results = await mapLimit(toMine, MINE_CONCURRENCY, async (c) => {
    let out;
    try {
      out = await complete(MINER_SYSTEM,
        `Source: ${title}\n\nExcerpt (pages ${c.page_from}-${c.page_to}):\n"""\n${c.text}\n"""\n\n` +
        `Extract every executable technique. Empty array is a valid answer if this excerpt is ` +
        `narrative, biography, or front matter.`);
    } catch (e) { log(`  chunk ${c.ord} failed: ${e.message}`); out = { techniques: [] }; }
    done++;
    await setStatus('mining', 0.25 + 0.45 * (done / toMine.length),
      `mined ${done}/${toMine.length} chunks`);
    return { chunk: c, techniques: out.techniques ?? [] };
  });

  // ── 6. validate + stage
  const { rows: chunkRows } = await db.query(
    `SELECT id, ord FROM kb_chunks WHERE document_id=$1`, [documentId]);
  const chunkIdByOrd = new Map(chunkRows.map(r => [r.ord, r.id]));

  const staged = [];
  for (const r of results) {
    for (const t of r.techniques) {
      const problems = validate(t);
      const { rows: [row] } = await db.query(`
        INSERT INTO kb_candidates (document_id, chunk_id, code, name, type, instruction,
          when_to_use, mechanism, example_do, example_dont, compatible_formats,
          compatible_tones, compatible_intensity, contested, contested_note, regex, quote,
          validation, disposition)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
        RETURNING id`,
        [documentId, chunkIdByOrd.get(r.chunk.ord) ?? null, t.code, t.name, t.type, t.instruction,
         t.when_to_use, t.mechanism, t.example_do, t.example_dont,
         t.compatible_formats ?? [], t.compatible_tones ?? [], t.compatible_intensity ?? [],
         !!t.contested, t.contested_note ?? null, t.regex ?? null, t.quote ?? null,
         JSON.stringify(problems), problems.length ? 'rejected' : 'pending']);
      if (!problems.length) staged.push({ ...t, _id: row.id });
    }
  }
  log(`  ${staged.length} passed validation`);

  // ── 7. dedup against the live library, then merge or insert
  await setStatus('merging', 0.75, `deduplicating ${staged.length} candidates`);

  const { rows: library } = await db.query(
    `SELECT id, code, name, type, instruction, when_to_use, mechanism, example_do, example_dont,
            compatible_formats, compatible_tones, compatible_intensity, contested,
            contested_note, embedding, document_ids, corroboration
       FROM techniques`);

  // embed everything in one pass
  const libNeedingEmb = library.filter(t => !t.embedding?.length);
  if (libNeedingEmb.length) {
    const embs = await embed(libNeedingEmb.map(t => `${t.name}. ${t.instruction}`));
    for (let i = 0; i < libNeedingEmb.length; i++) {
      libNeedingEmb[i].embedding = embs[i];
      await db.query(`UPDATE techniques SET embedding=$2 WHERE id=$1`, [libNeedingEmb[i].id, embs[i]]);
    }
  }
  const candEmbs = staged.length
    ? await embed(staged.map(t => `${t.name}. ${t.instruction}`)) : [];

  let inserted = 0, merged = 0, needsReview = 0, bannedAdded = 0, leversAdded = 0;
  const source = await ensureSource(db, documentId, title, author);

  for (let i = 0; i < staged.length; i++) {
    const t = staged[i], emb = candEmbs[i];

    // Nearest neighbour, but ONLY within the same technique type.
    // Embeddings place "state a measurable drawback" and "name a physical sensation" close
    // together — both are short imperative sentences about the reader — yet they are entirely
    // different techniques. Without this gate a merge silently overwrites a good row with
    // another row's content. Type equality is a hard precondition for merging.
    let best = null, bestSim = 0;
    for (const l of library) {
      if (l.type !== t.type) continue;
      const s = cosine(emb, l.embedding);
      if (s > bestSim) { bestSim = s; best = l; }
    }

    if (best && bestSim >= MERGE_THRESHOLD) {
      // same technique, different book → merge and bump corroboration
      let mergedT = null;
      try {
        mergedT = await complete(MERGE_SYSTEM,
          `EXISTING:\n${JSON.stringify(best, ['code','name','type','instruction','when_to_use','mechanism','example_do','example_dont','compatible_formats','compatible_tones','compatible_intensity','contested','contested_note'], 2)}\n\n` +
          `NEW (from "${title}"):\n${JSON.stringify(t, null, 2)}`);
      } catch { /* keep existing on failure */ }

      const m = mergedT ?? best;
      const docIds = [...new Set([...(best.document_ids ?? []), documentId])];
      await db.query(`
        UPDATE techniques SET instruction=$2, when_to_use=$3, mechanism=$4, example_do=$5,
               example_dont=$6, compatible_formats=$7, compatible_tones=$8,
               contested=$9, contested_note=$10, document_ids=$11,
               corroboration=$12, updated_at=now()
         WHERE id=$1`,
        [best.id, m.instruction, m.when_to_use, m.mechanism, m.example_do, m.example_dont,
         m.compatible_formats ?? best.compatible_formats, m.compatible_tones ?? best.compatible_tones,
         !!m.contested, m.contested_note ?? null, docIds, docIds.length]);
      await db.query(
        `UPDATE kb_candidates SET disposition='merged', merged_into=$2, similarity=$3, embedding=$4 WHERE id=$1`,
        [t._id, best.id, bestSim, emb]);
      best.instruction = m.instruction;
      merged++;
      continue;
    }

    if (best && bestSim >= REVIEW_THRESHOLD) {
      // ambiguous: similar but maybe a genuinely different nuance. Insert but flag it.
      needsReview++;
      await db.query(
        `UPDATE kb_candidates SET disposition='needs_review', merged_into=$2, similarity=$3, embedding=$4 WHERE id=$1`,
        [t._id, best.id, bestSim, emb]);
      continue;
    }

    // new technique
    const code = await uniqueCode(db, t.code);
    const { rows: [ins] } = await db.query(`
      INSERT INTO techniques (code,name,type,instruction,when_to_use,mechanism,example_do,
        example_dont,compatible_formats,compatible_tones,compatible_intensity,contested,
        contested_note,source_id,embedding,document_ids,corroboration,quote,review_state)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,1,$17,'auto')
      RETURNING id`,
      [code, t.name, t.type, t.instruction, t.when_to_use, t.mechanism, t.example_do,
       t.example_dont, t.compatible_formats ?? [], t.compatible_tones ?? [],
       t.compatible_intensity ?? [], !!t.contested, t.contested_note ?? null,
       source, emb, [documentId], t.quote ?? null]);
    library.push({ ...t, id: ins.id, embedding: emb, document_ids: [documentId] });
    await db.query(
      `UPDATE kb_candidates SET disposition='inserted', merged_into=$2, embedding=$3 WHERE id=$1`,
      [t._id, ins.id, emb]);
    inserted++;

    // ── 8. promote into the live posting machinery
    if (t.type === 'anti_pattern' && t.regex) {
      const r = await db.query(
        `INSERT INTO banned_phrases (pattern, reason, scope) VALUES ($1,$2,'all')
         ON CONFLICT DO NOTHING RETURNING id`,
        [t.regex, `${t.name} — ${title}`]);
      bannedAdded += r.rowCount;
    }
    if (['hook', 'structure'].includes(t.type) && t.instruction.length < 200) {
      const kind = t.type === 'hook' ? 'format' : 'angle';
      const r = await db.query(
        `INSERT INTO levers (kind, code, label, brief, enabled) VALUES ($1,$2,$3,$4,true)
         ON CONFLICT (kind, code) DO NOTHING RETURNING id`,
        [kind, `lib_${code}`, t.name, t.instruction]);
      leversAdded += r.rowCount;
    }
  }

  const { rows: [rej] } = await db.query(
    `SELECT count(*)::int c FROM kb_candidates WHERE document_id=$1 AND disposition='rejected'`,
    [documentId]);

  // A document that produced nothing is a problem worth surfacing, not a success. Usually it
  // means the PDF is narrative rather than instructional, or the miner model is misconfigured.
  const note = (inserted + merged) === 0
    ? 'No techniques extracted. The document may be narrative rather than instructional, or ' +
      'everything it contained is already in the library. Check the Candidates list.'
    : null;

  await db.query(`
    UPDATE kb_documents SET status='done', progress=1, stage_note=$9, finished_at=now(),
      techniques_found=$2, techniques_new=$3, techniques_merged=$4, techniques_rejected=$5,
      banned_added=$6, levers_added=$7, source_id=$8
     WHERE id=$1`,
    [documentId, staged.length, inserted, merged, rej.c, bannedAdded, leversAdded, source, note]);

  log(`  done: +${inserted} new, ${merged} merged, ${needsReview} to review, ${rej.c} rejected`);
  return { status: 'done', inserted, merged, needsReview, rejected: rej.c, bannedAdded, leversAdded };
}

async function ensureSource(db, documentId, title, author) {
  const { rows: [existing] } = await db.query(
    `SELECT id FROM technique_sources WHERE title=$1 LIMIT 1`, [title]);
  if (existing) return existing.id;
  const { rows: [s] } = await db.query(
    `INSERT INTO technique_sources (title, author, notes) VALUES ($1,$2,$3) RETURNING id`,
    [title, author, `auto-ingested, kb_documents.id=${documentId}`]);
  return s.id;
}

async function uniqueCode(db, base) {
  let code = base, i = 2;
  for (;;) {
    const { rowCount } = await db.query(`SELECT 1 FROM techniques WHERE code=$1`, [code]);
    if (!rowCount) return code;
    code = `${base}_${i++}`;
  }
}
