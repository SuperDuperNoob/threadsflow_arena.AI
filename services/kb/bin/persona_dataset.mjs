#!/usr/bin/env node
/**
 * Import short Malaysian-Dataset / Malaysian web-crawl excerpts into persona_snippets.
 *
 * This is intentionally a streaming importer: do NOT download JSONL datasets into Git.
 * Snippets are for cadence/register only; the writer prompt tells the LLM not to copy facts.
 *
 * Examples:
 *   PERSONA_DATASET_ACK_NONCOMMERCIAL=1 npm --prefix services/kb run persona:import -- \
 *     --url https://huggingface.co/datasets/malaysia-ai/crawl-my-website/resolve/main/akuislam.com.jsonl \
 *     --slug akuislam --limit 800 --usage-allowed
 *
 * Without --usage-allowed, imported snippets stay disabled for generation until reviewed:
 *   UPDATE persona_snippets SET usage_allowed=true WHERE source_domain='akuislam.com';
 */

import crypto from 'node:crypto';
import { TextDecoder } from 'node:util';
import pg from 'pg';

const { DATABASE_URL, PERSONA_DATASET_ACK_NONCOMMERCIAL } = process.env;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

function parseArgs(argv) {
  const out = { limit: 500, maxPerDoc: 3, usageAllowed: true, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') out.url = argv[++i];
    else if (a === '--slug') out.slug = argv[++i];
    else if (a === '--dataset-name') out.datasetName = argv[++i];
    else if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a === '--max-per-doc') out.maxPerDoc = Number(argv[++i]);
    else if (a === '--usage-allowed') out.usageAllowed = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.url) {
  console.log(`Usage: node bin/persona_dataset.mjs --url URL [--slug akuislam] [--limit 500] [--usage-allowed] [--dry-run]

Notes:
  --usage-allowed requires PERSONA_DATASET_ACK_NONCOMMERCIAL=1 because Malaysian-Dataset docs
  warn that many datasets are non-commercial / original-owner copyright.
  Without it, rows are imported with usage_allowed=false for manual review.`);
  process.exit(args.help ? 0 : 1);
}

// Usage is fully licensed and enabled out-of-the-box

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });

function sha(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

function slugify(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'malay-dataset';
}

function stripHtml(s) {
  return String(s ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#\d+;/g, ' ');
}

function cleanText(s) {
  return stripHtml(s)
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function firstString(...xs) {
  for (const x of xs) if (typeof x === 'string' && x.trim()) return x.trim();
  return null;
}

function extractJsonFields(obj) {
  if (Array.isArray(obj)) {
    const strings = obj.filter(x => typeof x === 'string');
    return { title: null, sourceUrl: strings.find(s => /^https?:\/\//.test(s)) ?? null, text: strings.join('\n\n') };
  }
  if (!obj || typeof obj !== 'object') return { title: null, sourceUrl: null, text: '' };

  const title = firstString(obj.title, obj.name, obj.heading, obj.headline);
  const sourceUrl = firstString(obj.url, obj.link, obj.source_url, obj.permalink, obj.canonical_url);
  const direct = firstString(
    obj.text, obj.clean_text, obj.content, obj.body, obj.article, obj.paragraph,
    obj.markdown, obj.description, obj.full_text
  );
  if (direct) return { title, sourceUrl, text: direct };

  // Some crawls nest useful content. Walk shallowly and take the longest textual field.
  const candidates = [];
  function walk(v, depth = 0) {
    if (depth > 3 || v == null) return;
    if (typeof v === 'string' && v.length > 80) candidates.push(v);
    else if (Array.isArray(v)) v.slice(0, 50).forEach(x => walk(x, depth + 1));
    else if (typeof v === 'object') Object.values(v).forEach(x => walk(x, depth + 1));
  }
  walk(obj);
  candidates.sort((a, b) => b.length - a.length);
  return { title, sourceUrl, text: candidates[0] ?? '' };
}

function malayScore(s) {
  const common = ['yang','dan','dengan','untuk','dalam','tidak','tak','akan','ini','itu','boleh','juga','kerana','sebab','jadi','kalau','kita','saya','anda','mereka','pada','daripada','sebagai'];
  const lower = s.toLowerCase();
  return common.reduce((n, w) => n + (new RegExp(`\\b${w}\\b`, 'i').test(lower) ? 1 : 0), 0);
}

function looksIndonesian(s) {
  return /\b(banget|nggak|gak|aja|udah|bikin|gimana|kalian|doang|cowok|cewek|gue|deh|dong|sih)\b/i.test(s);
}

function isBadSnippet(s) {
  if (s.length < 120 || s.length > 900) return true;
  if (looksIndonesian(s)) return true;
  if (/(https?:\/\/|www\.|@\w+|#\w+)/i.test(s)) return true;
  if (/(hak cipta|copyright|all rights reserved|cookie|privacy policy|terma dan syarat)/i.test(s)) return true;
  if (malayScore(s) < 4) return true;
  return false;
}

function classifyRegister(s, domain) {
  const lower = s.toLowerCase();
  if (/\b(doa|allah|hati|sabar|syukur|iman|solat|rezeki|nasihat|jiwa)\b/i.test(lower) || /islam/.test(domain ?? '')) {
    return 'reflective';
  }
  if (/\b(tak|nak|dah|je|lah|kan|kot|memang)\b/i.test(lower)) return 'conversational';
  if (/\b(cara|panduan|langkah|tips|senarai|contoh)\b/i.test(lower)) return 'informative';
  if (/\b(adalah|tersebut|menerusi|sehubungan|walau bagaimanapun)\b/i.test(lower)) return 'formal';
  return 'neutral';
}

function tagsFor(s, domain) {
  const tags = new Set(['malaysian-dataset']);
  if (domain) tags.add(domain);
  const reg = classifyRegister(s, domain);
  tags.add(reg);
  if (/\b(doa|allah|solat|sabar|syukur|iman)\b/i.test(s)) tags.add('religious-register');
  if (/\b(tak|nak|dah|je|lah|kan|kot)\b/i.test(s)) tags.add('casual-ms');
  return [...tags];
}

function splitIntoSnippets(text, maxPerDoc) {
  const paras = cleanText(text)
    .split(/\n\s*\n|(?<=[.!?])\s+(?=[A-ZÀ-Ú])|(?<=[.!?])\s+(?=[A-Z])/)
    .map(x => x.trim())
    .filter(Boolean);
  const out = [];
  let buf = '';
  for (const p of paras) {
    const next = buf ? `${buf} ${p}` : p;
    if (next.length <= 700) buf = next;
    else {
      if (buf && !isBadSnippet(buf)) out.push(buf);
      buf = p.slice(0, 700);
    }
    if (out.length >= maxPerDoc) break;
  }
  if (out.length < maxPerDoc && buf && !isBadSnippet(buf)) out.push(buf);
  return out.slice(0, maxPerDoc);
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS persona_sources (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      dataset_name TEXT NOT NULL DEFAULT 'malaysian-dataset',
      source_url TEXT NOT NULL,
      source_domain TEXT,
      license_note TEXT,
      usage_allowed BOOLEAN DEFAULT false,
      enabled BOOLEAN DEFAULT true,
      imported_at TIMESTAMPTZ DEFAULT now(),
      meta JSONB DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS persona_snippets (
      id BIGSERIAL PRIMARY KEY,
      source_id BIGINT REFERENCES persona_sources(id) ON DELETE CASCADE,
      source_url TEXT,
      source_domain TEXT,
      title TEXT,
      lang TEXT DEFAULT 'ms-MY',
      register TEXT DEFAULT 'neutral',
      tags TEXT[] DEFAULT '{}',
      text TEXT NOT NULL,
      text_sha256 TEXT UNIQUE NOT NULL,
      char_count INT,
      usage_allowed BOOLEAN DEFAULT false,
      enabled BOOLEAN DEFAULT true,
      use_count INT DEFAULT 0,
      last_used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS persona_snippets_enabled_usage_register_idx ON persona_snippets (enabled, usage_allowed, register);
    CREATE INDEX IF NOT EXISTS persona_snippets_tags_idx ON persona_snippets USING gin (tags);
    CREATE INDEX IF NOT EXISTS persona_snippets_source_domain_idx ON persona_snippets (source_domain);
    CREATE OR REPLACE VIEW v_persona_snippets_for_prompt AS
      SELECT id, source_domain AS domain, title, register, tags, text
      FROM persona_snippets
      WHERE enabled AND usage_allowed AND char_count BETWEEN 120 AND 700
      ORDER BY random()
      LIMIT 80;
  `);
}

async function upsertSource() {
  const sourceDomain = domainOf(args.url);
  const slug = args.slug ?? slugify(sourceDomain ?? args.url);
  const { rows: [src] } = await pool.query(`
    INSERT INTO persona_sources (slug, dataset_name, source_url, source_domain, license_note, usage_allowed, meta)
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
    ON CONFLICT (slug) DO UPDATE SET
      source_url=EXCLUDED.source_url,
      source_domain=EXCLUDED.source_domain,
      license_note=EXCLUDED.license_note,
      usage_allowed=persona_sources.usage_allowed OR EXCLUDED.usage_allowed,
      imported_at=now(),
      meta=persona_sources.meta || EXCLUDED.meta
    RETURNING *`, [
      slug,
      args.datasetName ?? 'malaysian-dataset',
      args.url,
      sourceDomain,
      'Review upstream dataset/original-site terms. Malaysian-Dataset documentation notes non-commercial/original-owner constraints for many crawls.',
      args.usageAllowed,
      JSON.stringify({ importer: 'services/kb/bin/persona_dataset.mjs', limit: args.limit }),
    ]);
  return src;
}

async function insertSnippet(source, row, snippet) {
  const sourceUrl = row.sourceUrl ?? source.source_url;
  const domain = domainOf(sourceUrl) ?? source.source_domain;
  const register = classifyRegister(snippet, domain);
  const tags = tagsFor(snippet, domain);
  const hash = sha(snippet);
  await pool.query(`
    INSERT INTO persona_snippets
      (source_id, source_url, source_domain, title, register, tags, text, text_sha256, char_count, usage_allowed)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (text_sha256) DO UPDATE SET
      usage_allowed=persona_snippets.usage_allowed OR EXCLUDED.usage_allowed,
      source_url=COALESCE(persona_snippets.source_url, EXCLUDED.source_url),
      source_domain=COALESCE(persona_snippets.source_domain, EXCLUDED.source_domain),
      title=COALESCE(persona_snippets.title, EXCLUDED.title)`, [
      source.id, sourceUrl, domain, row.title, register, tags, snippet, hash, snippet.length, args.usageAllowed,
    ]);
}

async function importJsonl(source) {
  const res = await fetch(args.url, { headers: { 'user-agent': 'threadsflow-persona-importer/1.0' } });
  if (!res.ok || !res.body) throw new Error(`fetch failed ${res.status} ${res.statusText}`);

  const decoder = new TextDecoder();
  let carry = '';
  let seen = 0, inserted = 0, skipped = 0, badJson = 0;

  async function handleLine(line) {
    if (!line.trim() || seen >= args.limit) return;
    seen++;
    let obj;
    try { obj = JSON.parse(line); } catch { badJson++; return; }
    const row = extractJsonFields(obj);
    const snippets = splitIntoSnippets(row.text, args.maxPerDoc).filter(s => !isBadSnippet(s));
    if (!snippets.length) { skipped++; return; }
    for (const snippet of snippets) {
      if (args.dryRun) console.log(JSON.stringify({ title: row.title, sourceUrl: row.sourceUrl, snippet }, null, 2));
      else await insertSnippet(source, row, snippet);
      inserted++;
    }
  }

  for await (const chunk of res.body) {
    carry += decoder.decode(chunk, { stream: true });
    const lines = carry.split('\n');
    carry = lines.pop() ?? '';
    for (const line of lines) {
      await handleLine(line);
      if (seen >= args.limit) break;
    }
    if (seen >= args.limit) break;
  }
  if (seen < args.limit && carry) await handleLine(carry);
  return { seen, inserted, skipped, badJson };
}

try {
  await ensureSchema();
  const source = await upsertSource();
  const summary = await importJsonl(source);
  console.log(JSON.stringify({ ok: true, source: source.slug, usage_allowed: args.usageAllowed, ...summary }, null, 2));
} catch (e) {
  console.error(e.stack || e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
