#!/usr/bin/env node
/**
 * Technique miner — one-time (or quarterly) job.
 *
 * Reads NotebookLM answers, runs them through the extractor prompt, and upserts into the
 * `techniques` table. Also routes anti-patterns into `banned_phrases` and strong
 * hook/structure/voice techniques into `levers` so the bandit tests them as full arms.
 *
 * Usage:
 *   1. Paste NotebookLM answers into mining_answers.json (see --template)
 *   2. node scripts/mine_techniques.mjs --answers mining_answers.json --source "Boron Letters"
 *   3. Review:  psql -c "SELECT code, type, instruction FROM techniques ORDER BY type"
 *   4. Prune anything you don't like BEFORE it starts consuming posting slots.
 *
 * Env: DATABASE_URL, LLM_BASE_URL, LLM_API_KEY, LLM_MODEL
 */

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith('--') ? [[a.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]]] : [])
);

const {
  DATABASE_URL,
  LLM_BASE_URL = 'http://localhost:9000/v1',
  LLM_API_KEY = '',
  LLM_MODEL = 'gemini-2.5-pro',
} = process.env;

// ─────────────────────────────────────────── template

if (args.template) {
  const tpl = [
    { question_ord: 1, question: 'List every distinct technique...', raw_answer: 'PASTE HERE' },
    { question_ord: 4, question: 'What makes copy sound fake...', raw_answer: 'PASTE HERE' },
  ];
  fs.writeFileSync('mining_answers.json', JSON.stringify(tpl, null, 2));
  console.log('Wrote mining_answers.json — paste your NotebookLM answers into raw_answer fields.');
  console.log('Get the question list with: psql -c "SELECT ord, question FROM mining_questions ORDER BY ord"');
  process.exit(0);
}

// ─────────────────────────────────────────── llm

async function llm(system, user) {
  const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${LLM_API_KEY}` },
    body: JSON.stringify({
      model: LLM_MODEL,
      temperature: 0.3,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const json = await res.json();
  let txt = json.choices[0].message.content.trim();
  txt = txt.replace(/^```(?:json)?\n?|```$/g, '');
  return JSON.parse(txt);
}

// ─────────────────────────────────────────── validation
// The extractor will occasionally emit abstract mush despite the prompt. Catch it here.

const ABSTRACT = /^(use|apply|employ|leverage|utilize|utilise|consider|remember|understand|be\s+(more\s+)?(specific|clear|concise|authentic|human|relatable))\b/i;
const VALID_TYPES = ['hook','structure','psychology','voice','cta','anti_pattern','proof','rhythm'];

function validate(t) {
  const problems = [];
  if (!t.code || !/^[a-z][a-z0-9_]{2,40}$/.test(t.code)) problems.push('bad code');
  if (!VALID_TYPES.includes(t.type)) problems.push(`bad type ${t.type}`);
  if (!t.instruction || t.instruction.length < 25) problems.push('instruction too short');
  if (t.instruction && t.instruction.length > 260) problems.push('instruction too long — not atomic');
  if (ABSTRACT.test(t.instruction ?? '')) problems.push('instruction is abstract, not executable');
  if ((t.instruction ?? '').split(/\s+and\s+/i).length > 2) problems.push('two actions in one — split it');
  if (!t.example_do || !t.example_dont) problems.push('missing examples');
  if (t.type === 'anti_pattern' && !t.regex) problems.push('anti_pattern without regex (kept as technique)');
  if (t.regex) { try { new RegExp(t.regex, 'iu'); } catch { problems.push('invalid regex'); } }
  return problems;
}

// ─────────────────────────────────────────── main

async function main() {
  if (!DATABASE_URL) throw new Error('DATABASE_URL not set');
  const answersPath = args.answers ?? 'mining_answers.json';
  const sourceTitle = args.source ?? 'NotebookLM copywriting library';
  const answers = JSON.parse(fs.readFileSync(answersPath, 'utf8'))
    .filter(a => a.raw_answer && a.raw_answer !== 'PASTE HERE');

  if (!answers.length) { console.error('No answers with content. Run --template first.'); process.exit(1); }

  const extractorPrompt = fs.readFileSync(
    path.join(path.dirname(new URL(import.meta.url).pathname), '../prompts/technique_extractor.md'), 'utf8');
  const [, system, userTpl] = extractorPrompt.split(/^## (?:SYSTEM|USER)$/m);

  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();

  const { rows: [src] } = await db.query(
    `INSERT INTO technique_sources (title, notes) VALUES ($1, $2) RETURNING id`,
    [sourceTitle, `mined from ${answers.length} NotebookLM answers`]);

  let kept = 0, dropped = 0, banned = 0, levered = 0;
  const rejectLog = [];

  for (const a of answers) {
    process.stdout.write(`Q${a.question_ord}… `);
    let out;
    try {
      out = await llm(system.trim(), userTpl
        .replace('{{source_title}}', sourceTitle)
        .replace('{{question}}', a.question)
        .replace('{{raw_answer}}', a.raw_answer));
    } catch (e) { console.log(`FAILED: ${e.message}`); continue; }

    for (const t of out.techniques ?? []) {
      const problems = validate(t);
      const fatal = problems.filter(p => !p.startsWith('anti_pattern without regex'));
      if (fatal.length) {
        dropped++; rejectLog.push({ code: t.code, problems: fatal, instruction: t.instruction });
        continue;
      }

      // anti-patterns with a regex go straight to the QA gate — highest value, zero cost
      if (t.type === 'anti_pattern' && t.regex) {
        await db.query(
          `INSERT INTO banned_phrases (pattern, reason, scope) VALUES ($1,$2,'all')
           ON CONFLICT DO NOTHING`, [t.regex, `${t.name} (${sourceTitle})`]);
        banned++;
      }

      await db.query(`
        INSERT INTO techniques (code,name,type,instruction,when_to_use,mechanism,
          example_do,example_dont,compatible_formats,compatible_tones,compatible_intensity,
          contested,contested_note,source_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (code) DO UPDATE SET
          instruction=EXCLUDED.instruction, example_do=EXCLUDED.example_do,
          example_dont=EXCLUDED.example_dont, updated_at=now()`,
        [t.code, t.name, t.type, t.instruction, t.when_to_use, t.mechanism,
         t.example_do, t.example_dont,
         t.compatible_formats ?? [], t.compatible_tones ?? [], t.compatible_intensity ?? [],
         !!t.contested, t.contested_note ?? null, src.id]);
      kept++;

      // Promote structural hooks to real lever values so the bandit tests them as full arms,
      // not just as devices. Only hooks/structures — tones and psychology stay as devices.
      if (['hook', 'structure'].includes(t.type) && t.instruction.length < 200) {
        const kind = t.type === 'hook' ? 'format' : 'angle';
        const r = await db.query(
          `INSERT INTO levers (kind, code, label, brief, enabled)
           VALUES ($1,$2,$3,$4,true) ON CONFLICT (kind, code) DO NOTHING RETURNING id`,
          [kind, `lib_${t.code}`, t.name, t.instruction]);
        if (r.rowCount) levered++;
      }
    }

    for (const r of out.rejected ?? []) rejectLog.push({ code: '(llm-rejected)', ...r });

    await db.query(`UPDATE mining_questions SET last_run=now(), raw_answer=$2 WHERE ord=$1`,
      [a.question_ord, a.raw_answer]);
    console.log(`+${(out.techniques ?? []).length}`);
  }

  fs.writeFileSync('mining_rejects.json', JSON.stringify(rejectLog, null, 2));

  console.log(`
─────────────────────────────────────────
  techniques kept        ${kept}
  dropped (too vague)    ${dropped}
  → banned_phrases       ${banned}
  → new lever values     ${levered}
─────────────────────────────────────────
Rejects written to mining_rejects.json — skim it, the drops are informative.

NEXT, and do not skip this:
  psql -c "SELECT code, type, instruction FROM techniques ORDER BY type, code"
Read every row. Delete anything that would sound wrong in your voice:
  psql -c "UPDATE techniques SET enabled=false WHERE code IN ('x','y')"

A bad technique doesn't just make one bad post — it burns posting slots for a whole cycle
before the bandit can down-weight it.
`);
  await db.end();
}

main().catch(e => { console.error(e); process.exit(1); });
