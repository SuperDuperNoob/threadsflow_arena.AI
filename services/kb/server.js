/**
 * Knowledge Base service — upload PDFs, get techniques.
 *
 * Web UI at /, JSON API for the main flow at /api/*.
 * The heavy work runs in an in-process worker loop (lib/worker.js) polling kb_jobs,
 * so an upload returns immediately and the UI polls for progress.
 */

import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import { sha256 } from './lib/pdf.js';
import { startWorker } from './lib/worker.js';
import { putImage, enrich, describeImage, shortId, getMediaKind, getExtension, deleteImage } from './lib/products.js';
import { registerShopeePool, getShopeeAvailability } from './lib/shopee.js';
import { registerApifyPool, getApifyAvailability } from './lib/apify_shopee.js';
import { searchTrendingProducts } from './lib/apify_discovery.js';
import { upsertConversionRows } from './lib/shopee_conversions.js';
import { clearLlmConfigCache, getLlmConfig, normalizeLlmConfig, registerLlmPool } from './lib/llm.js';
import { createLogger, hostOnly } from './lib/logger.js';

const {
  DATABASE_URL,
  PORT = 8082,
  IMAGE_DIR = '/data/images',
  KB_PASSWORD = '',
  KB_ALLOW_NO_PASSWORD = '',
  STORAGE_DIR = '/data/pdfs',
  MAX_UPLOAD_MB = 60,
} = process.env;

const log = createLogger('kb');

if (!KB_PASSWORD && KB_ALLOW_NO_PASSWORD !== 'true') {
  throw new Error('KB_PASSWORD is required. Set KB_ALLOW_NO_PASSWORD=true only for local development.');
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 6 });
pool.on('error', (err) => {
  log.error('pg_pool_idle_client_error', { reason: err.message, code: err.code });
});
// Let the Shopee and LLM clients read shared config from the `settings` table (repo convention).
registerShopeePool(pool);
registerApifyPool(pool);
registerLlmPool(pool);
const app = express();
app.use(express.json({ limit: '1mb' }));
app.disable('x-powered-by');

await fs.mkdir(STORAGE_DIR, { recursive: true });
await fs.mkdir(IMAGE_DIR, { recursive: true });

// ── auth: single shared password, constant-time compare, cookie session.
// Behind Cloudflare Access this is belt-and-braces, but the service can also run standalone.
function authed(req) {
  if (!KB_PASSWORD) return false;
  const cookie = (req.headers.cookie ?? '').match(/kb_session=([^;]+)/)?.[1];
  const expect = crypto.createHash('sha256').update(KB_PASSWORD).digest('hex');
  return cookie && cookie.length === expect.length &&
    crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(expect));
}
const requireAuth = (req, res, next) =>
  authed(req) ? next() : res.status(401).json({ error: 'unauthorized' });

app.post('/api/login', (req, res) => {
  if (!KB_PASSWORD) {
    return res.status(401).json({ error: 'KB_PASSWORD is not configured' });
  }
  if (req.body?.password === KB_PASSWORD) {
    const tok = crypto.createHash('sha256').update(KB_PASSWORD).digest('hex');
    res.setHeader('set-cookie',
      `kb_session=${tok}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`);
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'wrong password' });
});

app.get('/healthz', (req, res) => {
  log.debug('healthz_hit', { path: '/healthz' });
  res.type('text').send('ok');
});

// ─────────────────────────────────────────── upload

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 20 },
  fileFilter: (_, file, cb) =>
    cb(null, file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname)),
});

app.post('/api/upload', requireAuth, upload.array('pdfs', 20), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'no PDFs received' });
  const results = [];

  for (const f of req.files) {
    const hash = sha256(f.buffer);

    // Dedup level 1: identical bytes. Cheapest possible check, done before touching disk.
    const { rows: [dupe] } = await pool.query(
      `SELECT id, filename, title, status, techniques_new FROM kb_documents WHERE sha256=$1`, [hash]);
    if (dupe) {
      results.push({
        filename: f.originalname, status: 'duplicate',
        message: `Already ingested as "${dupe.title || dupe.filename}" (${dupe.techniques_new ?? 0} techniques)`,
        document_id: dupe.id,
      });
      continue;
    }

    const storagePath = path.join(STORAGE_DIR, `${hash}.pdf`);
    await fs.writeFile(storagePath, f.buffer);

    const { rows: [doc] } = await pool.query(
      `INSERT INTO kb_documents (filename, bytes, sha256, storage_path, status)
       VALUES ($1,$2,$3,$4,'queued') RETURNING id`,
      [f.originalname, f.size, hash, storagePath]);
    await pool.query(`INSERT INTO kb_jobs (document_id) VALUES ($1)`, [doc.id]);

    results.push({ filename: f.originalname, status: 'queued', document_id: doc.id });
  }

  res.json({ results });
});

// ─────────────────────────────────────────── status / library

app.get('/api/documents', requireAuth, async (_, res) => {
  const { rows } = await pool.query(`SELECT * FROM v_kb_library LIMIT 200`);
  res.json(rows);
});

app.get('/api/documents/:id', requireAuth, async (req, res) => {
  const { rows: [doc] } = await pool.query(`SELECT * FROM v_kb_library WHERE id=$1`, [req.params.id]);
  if (!doc) return res.status(404).json({ error: 'not found' });
  const { rows: cands } = await pool.query(
    `SELECT id, code, name, type, instruction, example_do, example_dont, quote,
            disposition, similarity, validation, contested
       FROM kb_candidates WHERE document_id=$1 ORDER BY disposition, type, code`,
    [req.params.id]);
  res.json({ ...doc, candidates: cands });
});

app.get('/api/stats', requireAuth, async (_, res) => {
  const q = s => pool.query(s).then(r => r.rows[0]);
  const [docs, tech, banned, levers, queue, perf] = await Promise.all([
    q(`SELECT count(*)::int total,
              count(*) FILTER (WHERE status='done')::int done,
              count(*) FILTER (WHERE status='duplicate')::int dupes,
              count(*) FILTER (WHERE status IN ('queued','extracting','chunking','mining','merging'))::int active,
              count(*) FILTER (WHERE status IN ('failed','rejected'))::int failed
         FROM kb_documents`),
    q(`SELECT count(*)::int total,
              count(*) FILTER (WHERE enabled)::int enabled,
              count(*) FILTER (WHERE contested)::int contested,
              count(*) FILTER (WHERE corroboration > 1)::int corroborated,
              count(*) FILTER (WHERE n > 0)::int in_use
         FROM techniques`),
    q(`SELECT count(*)::int total FROM banned_phrases`),
    q(`SELECT count(*)::int total FROM levers WHERE code LIKE 'lib_%'`),
    q(`SELECT count(*)::int pending FROM kb_jobs WHERE state IN ('pending','running')`),
    q(`SELECT count(*)::int review FROM kb_candidates WHERE disposition='needs_review'`),
  ]);
  res.json({ docs, tech, banned: banned.total, levers: levers.total,
             queue: queue.pending, needs_review: perf.review });
});

// ─────────────────────────────────────────── LLM settings
// One place to change the OpenAI-compatible endpoint used by n8n generation and KB mining.

const LLM_PRESETS = [
  {
    id: '9router_hosted',
    name: '9router hosted (default)',
    base_url: 'https://9router.archxry.space/v1',
    note: 'Works from Docker without exposing a local port. Usually simplest.',
  },
  {
    id: '9router_on_vps_host',
    name: '9router on this VPS host',
    base_url: 'http://host.docker.internal:20128/v1',
    note: 'Fastest if 9router runs on the VPS outside Docker. Do not use localhost inside containers.',
  },
  {
    id: 'openai_direct',
    name: 'OpenAI direct',
    base_url: 'https://api.openai.com/v1',
    note: 'Use your OpenAI API key and OpenAI model names.',
  },
  {
    id: 'openrouter_direct',
    name: 'OpenRouter direct',
    base_url: 'https://openrouter.ai/api/v1',
    note: 'Chat is OpenAI-compatible; choose an embeddings endpoint/model that supports /embeddings.',
  },
];

function publicLlmConfig(cfg) {
  const { api_key: apiKey, ...safe } = normalizeLlmConfig(cfg);
  return { ...safe, api_key_set: Boolean(apiKey) };
}

function validateLlmInput(body = {}, current = {}) {
  const next = normalizeLlmConfig({ ...current, ...body });
  const errors = [];
  try {
    const u = new URL(next.base_url);
    if (!['http:', 'https:'].includes(u.protocol)) errors.push('base_url must start with http:// or https://');
  } catch {
    errors.push('base_url is not a valid URL');
  }
  for (const k of ['model_write', 'model_edit', 'model_embed', 'model_mine']) {
    if (!next[k] || next[k].length > 200) errors.push(`${k} is required and must be under 200 characters`);
  }
  if (errors.length) {
    const e = new Error(errors.join('; '));
    e.status = 400;
    throw e;
  }

  if (body.clear_api_key) next.api_key = '';
  else if (typeof body.api_key === 'string' && body.api_key.trim()) next.api_key = body.api_key.trim();
  else next.api_key = current.api_key ?? next.api_key ?? '';

  return next;
}

async function llmConfigFromRequest(body = {}) {
  const current = await getLlmConfig();
  return validateLlmInput(body, current);
}

app.get('/api/config/llm', requireAuth, async (_req, res) => {
  const cfg = await getLlmConfig();
  const { rows } = await pool.query("SELECT 1 FROM settings WHERE key='llm'");
  res.json({ ...publicLlmConfig(cfg), source: rows.length ? 'settings.llm' : 'env/default', presets: LLM_PRESETS });
});

// ─────────────────────────────────────────── Generic System Settings (Step 3 Control Board)
// Allowlist built strictly from Step 0 ground-truth (dynamic keys only).
const SYSTEM_SETTINGS_ALLOWLIST = new Set(['posting', 'bandit', 'qa', 'l4_reply', 'warmup']);

function validateSystemSetting(key, body, current = {}) {
  const next = { ...current, ...body };
  const errors = [];
  if (key === 'posting') {
    if (next.skip_probability != null && (next.skip_probability < 0 || next.skip_probability > 1)) errors.push('skip_probability must be 0-1');
    if (next.carousel_probability != null && (next.carousel_probability < 0 || next.carousel_probability > 1)) errors.push('carousel_probability must be 0-1');
    if (next.jitter_minutes != null && next.jitter_minutes < 0) errors.push('jitter_minutes >= 0');
  }
  if (key === 'bandit' || key === 'scoring') {
    const s = key === 'scoring' ? next : next;
    if (s.epsilon != null && (s.epsilon < 0 || s.epsilon > 1)) errors.push('epsilon 0-1');
    if (s.decay != null && (s.decay < 0 || s.decay > 1)) errors.push('decay 0-1');
    if (s.loser_bottom_pct != null && (s.loser_bottom_pct < 0 || s.loser_bottom_pct > 1)) errors.push('loser_bottom_pct 0-1');
    if (s.winner_top_pct != null && (s.winner_top_pct < 0 || s.winner_top_pct > 1)) errors.push('winner_top_pct 0-1');
  }
  if (key === 'qa') {
    if (next.max_similarity != null && (next.max_similarity < 0 || next.max_similarity > 1)) errors.push('max_similarity 0-1');
    if (next.max_reply_length != null && next.max_reply_length < 1) errors.push('max_reply_length >= 1');
  }
  if (key === 'l4_reply') {
    ['max_replies_per_day','max_replies_per_post','cooldown_hours_per_user','post_age_days','min_comment_length'].forEach(f => {
      if (next[f] != null && next[f] < 0) errors.push(`${f} >= 0`);
    });
  }
  if (key === 'warmup') {
    if (next.persona_skip_prob != null && (next.persona_skip_prob < 0 || next.persona_skip_prob > 1)) errors.push('persona_skip_prob 0-1');
  }
  if (errors.length) {
    const e = new Error(errors.join('; '));
    e.status = 400;
    throw e;
  }
  return next;
}

app.get('/api/config/system/:key', requireAuth, async (req, res) => {
  const { key } = req.params;
  if (!SYSTEM_SETTINGS_ALLOWLIST.has(key)) return res.status(404).json({ error: 'unknown setting key' });
  const { rows } = await pool.query('SELECT value FROM settings WHERE key=$1', [key]);
  const value = rows[0]?.value || {};
  // Never return secrets (threads_creds etc. are already excluded from allowlist)
  res.json({ key, value });
});

app.put('/api/config/system/:key', requireAuth, async (req, res) => {
  const { key } = req.params;
  if (!SYSTEM_SETTINGS_ALLOWLIST.has(key)) return res.status(404).json({ error: 'unknown setting key' });
  try {
    const currentRow = await pool.query('SELECT value FROM settings WHERE key=$1', [key]);
    const current = currentRow.rows[0]?.value || {};
    const next = validateSystemSetting(key, req.body ?? {}, current);
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, JSON.stringify(next)]
    );
    res.json({ ok: true, key, value: next });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.put('/api/config/llm', requireAuth, async (req, res) => {
  try {
    const cfg = await llmConfigFromRequest(req.body ?? {});
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('llm', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
      [JSON.stringify(cfg)]);
    clearLlmConfigCache();
    log.info('llm_config_updated', {
      base_url_host: hostOnly(cfg.base_url), model_write: cfg.model_write,
      model_edit: cfg.model_edit, model_embed: cfg.model_embed, model_mine: cfg.model_mine,
      api_key_set: Boolean(cfg.api_key),
    });
    res.json({ ok: true, ...publicLlmConfig(cfg), presets: LLM_PRESETS });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/api/config/llm/test', requireAuth, async (req, res) => {
  const t0 = Date.now();
  try {
    const cfg = await llmConfigFromRequest(req.body ?? {});
    const r = await fetch(`${cfg.base_url.replace(/\/+$/, '')}/models`, {
      headers: cfg.api_key ? { authorization: `Bearer ${cfg.api_key}` } : {},
      signal: AbortSignal.timeout(15_000),
    });
    const text = await r.text();
    // host + status + latency only — the key must never appear in logs.
    log.info('llm_config_test', {
      endpoint: '/models', base_url_host: hostOnly(cfg.base_url),
      status: r.status, ok: r.ok, latency_ms: Date.now() - t0, api_key_set: Boolean(cfg.api_key),
    });
    if (!r.ok) return res.status(400).json({ ok: false, error: `HTTP ${r.status}: ${text.slice(0, 500)}` });
    let count = null;
    try { count = JSON.parse(text).data?.length ?? null; } catch { /* provider returned non-JSON */ }
    res.json({ ok: true, model_count: count });
  } catch (e) {
    log.warn('llm_config_test_failed', { endpoint: '/models', latency_ms: Date.now() - t0, reason: e.message });
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get('/api/techniques', requireAuth, async (req, res) => {
  const { type, q, enabled } = req.query;
  const where = [], params = [];
  if (type) { params.push(type); where.push(`type = $${params.length}`); }
  if (enabled === '1') where.push(`enabled`);
  if (q) { params.push(`%${q}%`); where.push(`(name ILIKE $${params.length} OR instruction ILIKE $${params.length})`); }
  const { rows } = await pool.query(
    `SELECT id, code, name, type, instruction, example_do, example_dont, when_to_use,
            compatible_formats, compatible_tones, contested, contested_note, corroboration,
            enabled, review_state, n, round(reward_sum/NULLIF(n,0),3) AS mean_reward
       FROM techniques ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY corroboration DESC, type, code LIMIT 500`, params);
  res.json(rows);
});

app.patch('/api/techniques/:id', requireAuth, async (req, res) => {
  const { enabled, review_state, instruction } = req.body ?? {};
  const { rows } = await pool.query(
    `UPDATE techniques SET
       enabled = COALESCE($2, enabled),
       review_state = COALESCE($3, review_state),
       instruction = COALESCE($4, instruction),
       updated_at = now()
     WHERE id=$1 RETURNING id, enabled, review_state`,
    [req.params.id, enabled ?? null, review_state ?? null, instruction ?? null]);
  res.json(rows[0] ?? { error: 'not found' });
});

// Review queue: candidates that were too similar to auto-insert but too different to auto-merge
app.get('/api/review', requireAuth, async (_, res) => {
  const { rows } = await pool.query(`
    SELECT c.id, c.name, c.type, c.instruction, c.example_do, c.similarity, c.quote,
           d.title AS from_document,
           t.id AS existing_id, t.name AS existing_name, t.instruction AS existing_instruction
      FROM kb_candidates c
      JOIN kb_documents d ON d.id = c.document_id
      LEFT JOIN techniques t ON t.id = c.merged_into
     WHERE c.disposition='needs_review'
     ORDER BY c.similarity DESC LIMIT 100`);
  res.json(rows);
});

app.post('/api/review/lock', requireAuth, async (req, res) => {
  req.url = `/api/posts/${req.body.post_id}/lock`;
  req.method = 'POST';
  app.handle(req, res);
});

app.post('/api/review/:id', requireAuth, async (req, res) => {
  const { action, decision } = req.body ?? {};   // KB: 'insert' | 'discard'; post review: approve/reject/edit
  if (decision || ['approved', 'rejected', 'edited', 'approve', 'reject', 'edit'].includes(action)) {
    req.url = `/api/posts/${req.params.id}/decision`;
    req.method = 'POST';
    return app.handle(req, res);
  }

  const { rows: [c] } = await pool.query(`SELECT * FROM kb_candidates WHERE id=$1`, [req.params.id]);
  if (!c) return res.status(404).json({ error: 'not found' });

  if (action === 'insert') {
    const { rows: [t] } = await pool.query(`
      INSERT INTO techniques (code,name,type,instruction,when_to_use,mechanism,example_do,
        example_dont,compatible_formats,compatible_tones,compatible_intensity,contested,
        contested_note,embedding,document_ids,quote,review_state)
      VALUES ($1||'_v',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'approved')
      RETURNING id`,
      [c.code, c.name, c.type, c.instruction, c.when_to_use, c.mechanism, c.example_do,
       c.example_dont, c.compatible_formats, c.compatible_tones, c.compatible_intensity,
       c.contested, c.contested_note, c.embedding, [c.document_id], c.quote]);
    await pool.query(`UPDATE kb_candidates SET disposition='inserted', merged_into=$2 WHERE id=$1`,
      [c.id, t.id]);
    return res.json({ ok: true, technique_id: t.id });
  }
  await pool.query(`UPDATE kb_candidates SET disposition='rejected' WHERE id=$1`, [c.id]);
  res.json({ ok: true });
});

app.post('/api/documents/:id/retry', requireAuth, async (req, res) => {
  await pool.query(`UPDATE kb_documents SET status='queued', error=NULL, progress=0 WHERE id=$1`,
    [req.params.id]);
  await pool.query(`INSERT INTO kb_jobs (document_id) VALUES ($1)`, [req.params.id]);
  res.json({ ok: true });
});

app.delete('/api/documents/:id', requireAuth, async (req, res) => {
  // Deletes the document and its candidates, but NOT techniques already merged into the
  // library — those have earned performance history that shouldn't be thrown away.
  const { rows: [d] } = await pool.query(`SELECT storage_path FROM kb_documents WHERE id=$1`,
    [req.params.id]);
  await pool.query(`DELETE FROM kb_documents WHERE id=$1`, [req.params.id]);
  if (d?.storage_path) await fs.unlink(d.storage_path).catch(() => {});
  res.json({ ok: true });
});

// ─────────────────────────────────────────── the endpoint the main flow calls
// wf2_generate hits this instead of querying Postgres directly, so the KB owns its own schema.

app.get('/api/kb/techniques-for-generation', async (req, res) => {
  const { format, tone, sell_intensity } = req.query;
  let context = {};
  if (req.query.context) {
    try { context = JSON.parse(String(req.query.context)); } catch { context = {}; }
  }
  const { rows } = await pool.query(`
    SELECT id, code, name, type, instruction, example_do, example_dont,
           compatible_formats, compatible_tones, compatible_intensity,
           compatible_media, contested, corroboration, n, alpha, beta, cooldown_until
      FROM techniques
     WHERE enabled AND review_state <> 'rejected' AND type <> 'anti_pattern'
       AND (cooldown_until IS NULL OR cooldown_until < now())
       AND (cardinality(compatible_formats)=0 OR $1 = ANY(compatible_formats))
       AND (cardinality(compatible_tones)=0   OR $2 = ANY(compatible_tones))
       AND (cardinality(compatible_intensity)=0 OR $3::smallint = ANY(compatible_intensity))`,
    [format ?? context.format ?? '', tone ?? context.tone ?? '', Number(sell_intensity ?? context.sell_intensity ?? 1)]);
  res.json({ ...context, techniques: rows });
});


// ═══════════════════════════════════════════ PRODUCT INTAKE
// The other half of the app: you add a product here, the n8n flow does the rest.

// Accept images (jpeg, png, webp) and videos (mp4, quicktime)
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 20 },
  fileFilter: (_, f, cb) => {
    const mt = f.mimetype?.toLowerCase() ?? '';
    const isImage = /^image\/(jpeg|png|webp)$/.test(mt);
    const isVideo = mt === 'video/mp4' || mt === 'video/quicktime';
    cb(null, isImage || isVideo);
  },
});

/**
 * Product intake. Three valid shapes:
 *   A) link + images
 *   B) link + images + description
 *   C) link + description            ← no images at all
 *
 * The only universally required field is the affiliate URL — the buyer/money link. The optional
 * product_url is the plain Shopee product page used only for enrichment, because affiliate short
 * links often hide the item id. Beyond that the rule is simple: the system needs SOMETHING
 * concrete to write from. Images supply it visually (via the vision pass); a description supplies
 * it in words. With neither, every post would be invented, and invented copy is exactly the
 * generic slop this whole project exists to avoid.
 */
function cleanHttpUrl(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    return ['http:', 'https:'].includes(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

app.post('/api/products', requireAuth, mediaUpload.array('images', 20), async (req, res) => {
  const { affiliate_url, product_url, name, price_myr, notes, description } = req.body ?? {};
  const files = req.files ?? [];
  const desc = (description ?? '').trim();
  const affiliateUrl = cleanHttpUrl(affiliate_url);
  const productUrl = cleanHttpUrl(product_url);

  if (!affiliateUrl) {
    return res.status(400).json({ error: 'A valid Shopee affiliate link is required.' });
  }
  if (productUrl === null) {
    return res.status(400).json({ error: 'Product URL must be a valid http(s) URL, or blank.' });
  }

  // Determine media mode: if any video present -> mixed, else images, else text
  const hasVideo = files.some(f => getMediaKind(f.mimetype) === 'VIDEO');
  const hasImage = files.some(f => getMediaKind(f.mimetype) === 'IMAGE');
  const mediaMode = (hasVideo || hasImage) ? 'images' : 'text';

  // Text-only posts have no photo to carry specificity, so the description has to. 80 chars is
  // roughly one real sentence with a number in it — below that the writer has nothing to anchor
  // to and will pad with adjectives.
  const MIN_DESC_TEXT_ONLY = 80;
  const MIN_DESC_WITH_IMAGES = 0;
  const minDesc = mediaMode === 'text' ? MIN_DESC_TEXT_ONLY : MIN_DESC_WITH_IMAGES;

  if (desc.length < minDesc) {
    return res.status(400).json({
      error: files.length === 0
        ? `No images supplied, so a description of at least ${MIN_DESC_TEXT_ONLY} characters is ` +
          `required (you gave ${desc.length}). Include concrete facts: measurements, price, ` +
          `material, how long you have used it, who it is for.`
        : `Description too short.`,
    });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const uid = shortId(6);
    const { rows: [p] } = await client.query(
      `INSERT INTO products (uid, name, affiliate_url, product_url, description, notes, media_mode)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, uid`,
      [uid, name || null, affiliateUrl, productUrl || null, desc || null, notes || null, mediaMode]);

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const mediaKind = getMediaKind(f.mimetype);
      const ext = getExtension(f.mimetype);
      const key = `${uid}/${i}-${sha256(f.buffer).slice(0, 8)}.${ext}`;
      const url = await putImage(f.buffer, key, f.mimetype);
      await client.query(
        `INSERT INTO product_images (product_id, public_url, bytes, media_kind) VALUES ($1,$2,$3,$4)`,
        [p.id, url, f.size, mediaKind]);
    }
    await client.query('COMMIT');

    log.info('product_added', {
      product_uid: uid, image_count: files.length, media_mode: mediaMode,
      has_description: desc.length > 0, affiliate_host: hostOnly(affiliateUrl),
    });

    // Enrichment and vision run AFTER the commit and are allowed to fail — the product
    // already exists and is postable. Never let an external call block the user.
    (async () => {
      try {
        log.debug('enrichment_started', { product_uid: uid });
        const t0 = Date.now();
        const e = await enrich({ affiliateUrl, productUrl, name, priceIdr: price_myr,
                                 notes, description: desc, mediaMode });
        await pool.query(`UPDATE products SET name=COALESCE($2,name), enrichment=$3 WHERE id=$1`,
          [p.id, e.name ?? null, JSON.stringify(e)]);
        log.info('enrichment_succeeded', {
          product_uid: uid, latency_ms: Date.now() - t0, enriched: e.enriched === true,
          source: e.shopee_source ?? null, facts: (e.concrete_details ?? []).length,
          detail_confidence: e.detail_confidence ?? null,
        });
        const { rows: imgs } = await pool.query(
          `SELECT id, public_url, media_kind FROM product_images WHERE product_id=$1`, [p.id]);
        for (const im of imgs) {
          const d = await describeImage(im.public_url, im.media_kind);
          if (d) await pool.query(`UPDATE product_images SET vision_desc=$2 WHERE id=$1`, [im.id, d]);
          if (d) log.debug('vision_desc_succeeded', { product_uid: uid, image_id: im.id });
          else log.warn('vision_desc_failed', { product_uid: uid, image_id: im.id });
        }
      } catch (err) {
        log.warn('enrichment_failed', { product_uid: uid, reason: err.message });
        await pool.query(
          `INSERT INTO run_log (workflow, level, message) VALUES ('kb_intake','warn',$1)`,
          [`enrichment failed for product ${p.uid}: ${err.message}`.slice(0, 500)]).catch(() => {});
      }
    })();

    res.json({ ok: true, product_uid: p.uid, product_id: p.id,
               images: files.length, media_mode: mediaMode,
               image_count: files.filter(f => getMediaKind(f.mimetype) === 'IMAGE').length,
               video_count: files.filter(f => getMediaKind(f.mimetype) === 'VIDEO').length,
               product_url: productUrl || null });
  } catch (e) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: e.message });
  } finally {
    if (client) client.release();
  }
});

app.get('/api/products', requireAuth, async (_, res) => {
  const { rows } = await pool.query(`
    SELECT p.id, p.uid, p.name, p.status, p.affiliate_url, p.product_url, p.created_at,
           p.enrichment->>'price_myr' AS price_myr,
           jsonb_array_length(COALESCE(p.enrichment->'concrete_details','[]'::jsonb)) AS facts,
           p.media_mode,
           (SELECT count(*) FROM product_images pi WHERE pi.product_id=p.id) AS images,
           (SELECT count(*) FROM posts po WHERE po.product_id=p.id AND po.status='published') AS posted
      FROM products p ORDER BY p.created_at DESC LIMIT 200`);
  res.json(rows);
});

app.get('/api/products/stats', requireAuth, async (_req, res) => {
  try {
    const { rows: [stats] } = await pool.query(`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE status = 'active')::int AS active,
        count(*) FILTER (WHERE status = 'archived')::int AS archived,
        count(*) FILTER (WHERE status = 'resting')::int AS resting,
        count(*) FILTER (WHERE media_mode = 'images')::int AS with_media,
        count(*) FILTER (WHERE media_mode = 'text')::int AS text_only
      FROM products`);
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/products/:id', requireAuth, async (req, res) => {
  const idParam = req.params.id;
  const isNumeric = /^\d+$/.test(idParam);
  const whereClause = isNumeric ? 'p.id = $1' : 'p.uid = $1';
  try {
    const { rows: [product] } = await pool.query(`
      SELECT p.id, p.uid, p.name, p.affiliate_url, p.product_url, p.description, p.notes,
             p.media_mode, p.status, p.rest_until, p.enrichment, p.created_at
      FROM products p WHERE ${whereClause}`, [idParam]);
    if (!product) return res.status(404).json({ error: 'product not found' });

    const { rows: images } = await pool.query(`
      SELECT id, public_url, media_kind, vision_desc, width, height, bytes, created_at
      FROM product_images WHERE product_id = $1 ORDER BY created_at ASC`, [product.id]);

    const { rows: [{ count: posts_count }] } = await pool.query(`
      SELECT count(*) FROM posts WHERE product_id = $1`, [product.id]);

    res.json({ ...product, images, posts_count: Number(posts_count) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── helper: find product by id or uid, returns product row or null
async function findProductByIdOrUid(idParam) {
  const isNumeric = /^\d+$/.test(idParam);
  const whereClause = isNumeric ? 'p.id = $1' : 'p.uid = $1';
  const { rows: [product] } = await pool.query(`
    SELECT p.id, p.uid, p.name, p.affiliate_url, p.product_url, p.description, p.notes,
           p.media_mode, p.status, p.rest_until, p.enrichment, p.created_at
    FROM products p WHERE ${whereClause}`, [idParam]);
  return product;
}

// ─── helper: return full product detail (used by GET :id and PATCH :id)
async function getProductDetail(productId) {
  const { rows: images } = await pool.query(`
    SELECT id, public_url, media_kind, vision_desc, width, height, bytes, created_at
    FROM product_images WHERE product_id = $1 ORDER BY created_at ASC`, [productId]);
  const { rows: [{ count: posts_count }] } = await pool.query(`
    SELECT count(*) FROM posts WHERE product_id = $1`, [productId]);
  const { rows: [product] } = await pool.query(`
    SELECT p.id, p.uid, p.name, p.affiliate_url, p.product_url, p.description, p.notes,
           p.media_mode, p.status, p.rest_until, p.enrichment, p.created_at
    FROM products p WHERE p.id = $1`, [productId]);
  return { ...product, images, posts_count: Number(posts_count) };
}

// PATCH /api/products/:id — partial update of name, affiliate_url, product_url, description, notes
app.patch('/api/products/:id', requireAuth, async (req, res) => {
  const idParam = req.params.id;
  const product = await findProductByIdOrUid(idParam);
  if (!product) return res.status(404).json({ error: 'product not found' });

  const {
    affiliate_url,
    product_url,
    name,
    description,
    notes,
  } = req.body ?? {};

  // Merge: use new value if provided, else keep existing
  const mergedAffiliateUrl = affiliate_url !== undefined ? cleanHttpUrl(affiliate_url) : product.affiliate_url;
  const mergedProductUrl = product_url !== undefined ? cleanHttpUrl(product_url) : product.product_url;
  const mergedName = name !== undefined ? (name || null) : product.name;
  const mergedDescription = description !== undefined ? (description ?? '').trim() : product.description;
  const mergedNotes = notes !== undefined ? (notes || null) : product.notes;

  // Validate merged affiliate_url
  if (!mergedAffiliateUrl) {
    return res.status(400).json({ error: 'A valid Shopee affiliate link is required.' });
  }
  // Validate merged product_url (if non-empty)
  if (mergedProductUrl === null) {
    return res.status(400).json({ error: 'Product URL must be a valid http(s) URL, or blank.' });
  }
  // Check image count for text-only requirement
  const { rows: [{ cnt: imgCount }] } = await pool.query(
    `SELECT count(*)::int AS cnt FROM product_images WHERE product_id = $1`, [product.id]);
  if (imgCount === 0 && mergedDescription && mergedDescription.length < 80) {
    return res.status(400).json({
      error: `No images on this product, so description must be at least 80 characters (currently ${mergedDescription.length}).`
    });
  }
  if (imgCount === 0 && (!mergedDescription || mergedDescription.length < 80)) {
    return res.status(400).json({
      error: `No images on this product, so a description of at least 80 characters is required (you gave ${mergedDescription?.length ?? 0}).`
    });
  }

  try {
    await pool.query(`
      UPDATE products
      SET affiliate_url = $2, product_url = $3, name = $4, description = $5, notes = $6
      WHERE id = $1`,
      [product.id, mergedAffiliateUrl, mergedProductUrl, mergedName, mergedDescription, mergedNotes]);

    const detail = await getProductDetail(product.id);
    res.json(detail);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/products/:id/archive — set status = 'archived'
app.post('/api/products/:id/archive', requireAuth, async (req, res) => {
  const idParam = req.params.id;
  const product = await findProductByIdOrUid(idParam);
  if (!product) return res.status(404).json({ error: 'product not found' });

  try {
    await pool.query(`UPDATE products SET status = 'archived' WHERE id = $1`, [product.id]);
    const { rows: [updated] } = await pool.query(`SELECT id, uid, status FROM products WHERE id = $1`, [product.id]);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/products/:id/restore — set status = 'active'
app.post('/api/products/:id/restore', requireAuth, async (req, res) => {
  const idParam = req.params.id;
  const product = await findProductByIdOrUid(idParam);
  if (!product) return res.status(404).json({ error: 'product not found' });

  try {
    await pool.query(`UPDATE products SET status = 'active' WHERE id = $1`, [product.id]);
    const { rows: [updated] } = await pool.query(`SELECT id, uid, status FROM products WHERE id = $1`, [product.id]);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/products/:id/images — add more images/videos
app.post('/api/products/:id/images', requireAuth, mediaUpload.array('images', 20), async (req, res) => {
  const idParam = req.params.id;
  const product = await findProductByIdOrUid(idParam);
  if (!product) return res.status(404).json({ error: 'product not found' });

  const files = req.files ?? [];
  if (!files.length) return res.status(400).json({ error: 'no images received' });

  const { rows: [{ cnt: existingCount }] } = await pool.query(
    `SELECT count(*)::int AS cnt FROM product_images WHERE product_id = $1`, [product.id]);
  if (existingCount + files.length > 20) {
    return res.status(400).json({ error: 'A product can have at most 20 images/videos total.' });
  }

  const inserted = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const mediaKind = getMediaKind(f.mimetype);
    const ext = getExtension(f.mimetype);
    const key = `${product.uid}/${Date.now()}-${i}-${sha256(f.buffer).slice(0, 8)}.${ext}`;
    const url = await putImage(f.buffer, key, f.mimetype);
    const { rows: [img] } = await pool.query(
      `INSERT INTO product_images (product_id, public_url, bytes, media_kind) VALUES ($1,$2,$3,$4) RETURNING id, public_url, media_kind, created_at`,
      [product.id, url, f.size, mediaKind]);
    inserted.push(img);
  }

  // Recompute media_mode: if product now has any images, set to 'images'
  if (existingCount === 0 && inserted.length > 0) {
    await pool.query(`UPDATE products SET media_mode = 'images' WHERE id = $1`, [product.id]);
  }

  res.json({ ok: true, added: inserted.length, images: inserted });
});

// DELETE /api/products/:id/images/:imageId — delete an image/video
app.delete('/api/products/:id/images/:imageId', requireAuth, async (req, res) => {
  const idParam = req.params.id;
  const imageId = Number(req.params.imageId);
  if (!Number.isInteger(imageId)) return res.status(400).json({ error: 'invalid image id' });

  const product = await findProductByIdOrUid(idParam);
  if (!product) return res.status(404).json({ error: 'product not found' });

  // Look up image by id AND product_id (ownership check)
  const { rows: [image] } = await pool.query(
    `SELECT id, public_url FROM product_images WHERE id = $1 AND product_id = $2`,
    [imageId, product.id]);
  if (!image) return res.status(404).json({ error: 'image not found on this product' });

  // Check if used by any queued/publishing post
  const { rows: usingPosts } = await pool.query(
    `SELECT id FROM posts WHERE $1 = ANY(image_ids) AND status IN ('queued','publishing')`,
    [imageId]);
  if (usingPosts.length > 0) {
    return res.status(409).json({
      error: `This image is used by ${usingPosts.length} scheduled post(s). Wait for them to publish or be skipped before deleting it.`
    });
  }

  // Count total images on this product
  const { rows: [{ cnt: totalImages }] } = await pool.query(
    `SELECT count(*)::int AS cnt FROM product_images WHERE product_id = $1`, [product.id]);

  // If last image and description < 80 chars, block
  if (totalImages === 1) {
    const desc = product.description ?? '';
    if (desc.length < 80) {
      return res.status(409).json({
        error: `This is the product's only image/video and its description is under 80 characters. Lengthen the description before removing the last media file.`
      });
    }
  }

  // Best-effort delete from storage
  try {
    await deleteImage(image.public_url);
  } catch (e) {
    log.warn('delete_image_storage_failed', { image_id: imageId, product_id: product.id, reason: e.message });
  }

  // Delete DB row
  await pool.query(`DELETE FROM product_images WHERE id = $1`, [imageId]);

  // Recompute media_mode
  const { rows: [{ cnt: remaining }] } = await pool.query(
    `SELECT count(*)::int AS cnt FROM product_images WHERE product_id = $1`, [product.id]);
  const newMediaMode = remaining === 0 ? 'text' : 'images';
  if (newMediaMode !== product.media_mode) {
    await pool.query(`UPDATE products SET media_mode = $2 WHERE id = $1`, [product.id, newMediaMode]);
  }

  res.json({ ok: true, media_mode: newMediaMode });
});

// ─────────────────────────────────────────── Shopee Open API status + conversion import
// Lets the UI/runbook show whether keys are present, and lets n8n (or a manual CSV upload)
// push conversion rows in. The wf5 learning loop normally pulls these straight from the
// Shopee Affiliate Open API via lib/shopee_conversions.js; this endpoint is the fallback
// path for when you would rather POST a normalized CSV.

app.get('/api/shopee/status', requireAuth, async (_req, res) => {
  // `missing` is intentionally non-sensitive; it makes the no-credential fallback visible
  // without ever returning the App ID or API secret.
  res.json(await getShopeeAvailability());
});

app.get('/api/apify/status', requireAuth, async (_req, res) => {
  res.json(await getApifyAvailability());
});

// Tokens are write-only: list/edit/delete operations reveal labels and state, never token bytes.
app.get('/api/apify/keys', requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT k.id,k.label,k.active,k.priority,k.disabled_until,k.created_at,
      COALESCE(u.runs,0)::int AS runs_this_month FROM apify_api_keys k
      LEFT JOIN apify_key_monthly_usage u ON u.key_id=k.id AND u.month=date_trunc('month',now())::date
      ORDER BY k.priority,k.id`);
    res.json(rows);
  } catch (e) {
    console.error('apify keys list failed', e.message);
    return res.status(500).json({error:'list failed — check server logs'});
  }
});
app.post('/api/apify/keys', requireAuth, async (req, res) => {
  const label=String(req.body?.label??'').trim(), token=String(req.body?.token??'').trim();
  if (!label || label.length>80 || !token || token.length>1000) return res.status(400).json({error:'label and token are required'});
  try { const {rows:[key]}=await pool.query(`INSERT INTO apify_api_keys(label,token,priority) VALUES($1,$2,$3) RETURNING id,label,active,priority,created_at`,[label,token,Number(req.body?.priority)||100]); res.status(201).json(key); }
  catch(e) {
    if (e.code === '23505') return res.status(400).json({error:'key label already exists'});
    console.error('apify key insert failed', e.message);
    return res.status(500).json({error:'insert failed — check server logs'});
  }
});
app.put('/api/apify/keys/:id', requireAuth, async (req,res) => {
  const id=Number(req.params.id); if (!Number.isInteger(id)) return res.status(400).json({error:'invalid key id'});
  const label=String(req.body?.label??'').trim(); if (!label || label.length>80) return res.status(400).json({error:'label is required'});
  const token=typeof req.body?.token==='string'&&req.body.token.trim()?req.body.token.trim():null;
  const {rows:[key]}=await pool.query(`UPDATE apify_api_keys SET label=$2,priority=$3,active=$4,token=COALESCE($5,token),disabled_until=CASE WHEN $4 THEN NULL ELSE disabled_until END,updated_at=now() WHERE id=$1 RETURNING id,label,active,priority,disabled_until`,[id,label,Number(req.body?.priority)||100,req.body?.active!==false,token]);
  if(!key)return res.status(404).json({error:'key not found'}); res.json(key);
});
app.delete('/api/apify/keys/:id', requireAuth, async (req,res) => { const r=await pool.query('DELETE FROM apify_api_keys WHERE id=$1',[req.params.id]); if(!r.rowCount)return res.status(404).json({error:'key not found'}); res.json({ok:true}); });

app.post('/api/research/shopee', requireAuth, async (req,res) => {
  const keyword=String(req.body?.keyword??'').trim(), sort=req.body?.sort??'sales', maxProducts=Math.max(1,Math.min(20,Number(req.body?.max_products)||20));
  const {rows:[run]}=await pool.query(`INSERT INTO product_research_runs(keyword,sort,max_products,status) VALUES($1,$2,$3,'running') RETURNING id`,[keyword,sort,maxProducts]);
  const out=await searchTrendingProducts({keyword,sort,maxProducts});
  if(!out.ok){await pool.query(`UPDATE product_research_runs SET status=$2,error_code=$3,completed_at=now() WHERE id=$1`,[run.id,out.reason==='key_monthly_limit_reached'?'budget_blocked':'failed',out.reason]);return res.status(out.reason==='invalid_keyword'||out.reason==='invalid_sort'?400:200).json({ok:false,run_id:run.id,reason:out.reason});}
  for(const c of out.candidates){await pool.query(`INSERT INTO product_research_candidates(run_id,shop_id,item_id,product_url,title,image_url,currency,price,original_price,discount_pct,rating,rating_count,sold_count,location,is_mall,opportunity_score) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,[run.id,c.shop_id,c.item_id,c.product_url,c.title,c.image_url,c.currency,c.price,c.original_price,c.discount_pct,c.rating,c.rating_count,c.sold_count,c.location,c.is_mall,c.opportunity_score]);await pool.query(`INSERT INTO product_research_snapshots(shop_id,item_id,price,rating,rating_count,sold_count) VALUES($1,$2,$3,$4,$5,$6)`,[c.shop_id,c.item_id,c.price,c.rating,c.rating_count,c.sold_count]);}
  await pool.query(`UPDATE product_research_runs SET status='succeeded',candidate_count=$2,completed_at=now() WHERE id=$1`,[run.id,out.candidates.length]);res.json({ok:true,run_id:run.id,candidates:out.candidates});
});
app.get('/api/research/shopee/runs', requireAuth, async (_req,res)=>{const {rows}=await pool.query('SELECT * FROM product_research_runs ORDER BY created_at DESC LIMIT 30');res.json(rows);});
app.get('/api/research/shopee/runs/:id/candidates', requireAuth, async (req,res)=>{const {rows}=await pool.query('SELECT * FROM product_research_candidates WHERE run_id=$1 ORDER BY opportunity_score DESC',[req.params.id]);res.json(rows);});

app.post('/api/import/conversions', requireAuth, async (req, res) => {
  const rows = req.body?.rows;
  if (!Array.isArray(rows)) {
    return res.status(400).json({ error: 'expected JSON body { "rows": [ ... ] }' });
  }
  const norm = rows
    .map((r) => ({
      post_uid: r.post_uid ?? null,
      order_id: String(r.order_id ?? r.conversion_id ?? ''),
      order_ts: r.order_ts ? new Date(r.order_ts) : null,
      item_name: r.item_name ?? null,
      gmv: Number(r.gmv ?? r.gmv_idr ?? 0) || null,
      commission: Number(r.commission ?? r.commission_idr ?? 0) || null,
      status: (r.status ?? 'pending').toString().toLowerCase(),
    }))
    .filter((r) => r.order_id);

  if (!norm.length) return res.status(400).json({ error: 'no rows with an order_id' });

  try {
    const { inserted, updated } = await upsertConversionRows(pool, norm);
    res.json({ ok: true, received: norm.length, inserted, updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Serve stored images publicly when IMAGE_BACKEND=local. Meta must be able to fetch these,
// so this route is intentionally NOT behind requireAuth.
// ─────────────────────────────────────────── HUMAN-IN-THE-LOOP REVIEW API (Full compliance routes)

app.get('/api/posts/queue', requireAuth, async (_, res) => {
  // Timeout sweep: flip overdue pending_review posts to auto_published unless locked
  await pool.query(`
    WITH overdue AS (
      UPDATE posts
         SET status = 'auto_published'
       WHERE status = 'pending_review'
         AND review_timeout_at <= now()
         AND (review_locked_until IS NULL OR review_locked_until < now())
       RETURNING id
    )
    INSERT INTO post_review (post_id, decision, reviewed_by, reason_note)
    SELECT id, 'auto_published', 'timeout_scheduler', 'timeout reached without human review'
    FROM overdue
    ON CONFLICT DO NOTHING;
  `);

  const { rows } = await pool.query(`
    SELECT p.id, p.uid, p.body, p.format, p.angle, p.tone, p.sell_intensity,
           p.length_band, p.scheduled_at, p.purpose, pr.name AS product_name,
           p.status, p.review_timeout_at, p.review_locked_until,
           COALESCE((p.topic_context->>'is_exploration')::boolean, false) AS is_exploration,
           (SELECT edited_body FROM post_review WHERE post_id = p.id AND edited_body IS NOT NULL ORDER BY id DESC LIMIT 1) AS edited_body
      FROM posts p
      LEFT JOIN products pr ON pr.id = p.product_id
     WHERE p.status = 'pending_review'
     ORDER BY p.scheduled_at ASC
     LIMIT 100
  `);
  res.json(rows);
});

app.post('/api/posts/:id/lock', requireAuth, async (req, res) => {
  const postId = Number(req.params.id);
  if (!postId) return res.status(400).json({ error: 'post id required' });
  await pool.query(`
    UPDATE posts
       SET review_locked_until = now() + interval '10 minutes'
     WHERE id = $1 AND status = 'pending_review'
  `, [postId]);
  res.json({ ok: true });
});

app.post('/api/posts/:id/decision', requireAuth, async (req, res) => {
  const postId = Number(req.params.id);
  const { decision, reason_code, reason_note, edited_body } = req.body ?? {};
  const action = decision || req.body?.action;
  
  if (!['approved', 'rejected', 'edited', 'approve', 'reject', 'edit'].includes(action)) {
    return res.status(400).json({ error: 'invalid decision/action' });
  }

  const normalizedDecision = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action === 'edit' ? 'edited' : action;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    if (normalizedDecision === 'approved') {
      await client.query(`
        UPDATE posts
           SET status = 'approved', review_locked_until = NULL
         WHERE id = $1
      `, [postId]);
      await client.query(`
        INSERT INTO post_review (post_id, decision, reviewed_by)
        VALUES ($1, 'approved', 'operator')
      `, [postId]);
    } else if (normalizedDecision === 'rejected') {
      await client.query(`
        UPDATE posts
           SET status = 'rejected', fail_reason = $2, review_locked_until = NULL
         WHERE id = $1
      `, [postId, `rejected by operator: ${reason_code || 'other'}`]);
      await client.query(`
        INSERT INTO post_review (post_id, decision, reason_code, reason_note, reviewed_by)
        VALUES ($1, 'rejected', $2, $3, 'operator')
      `, [postId, reason_code || 'other', reason_note || null]);
    } else if (normalizedDecision === 'edited') {
      if (!edited_body || typeof edited_body !== 'string') {
        return res.status(400).json({ error: 'edited_body required for edited action' });
      }
      await client.query(`
        UPDATE posts
           SET body = $2, status = 'approved', review_locked_until = NULL
         WHERE id = $1
      `, [postId, edited_body]);
      await client.query(`
        INSERT INTO post_review (post_id, decision, edited_body, reviewed_by)
        VALUES ($1, 'edited', $2, 'operator')
      `, [postId, edited_body]);
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.get('/api/posts/weekly', requireAuth, async (_, res) => {
  const { rows: armStats } = await pool.query(`
    SELECT lever_kind, lever_code, round(n,1) AS n, round(reward_sum/NULLIF(n,0),3) AS mean_reward,
           round(alpha,2) AS alpha, round(beta,2) AS beta
      FROM arm_stats WHERE scope='global' ORDER BY mean_reward DESC LIMIT 30
  `);
  const { rows: audits } = await pool.query(`
    SELECT r.*, p.uid AS post_uid FROM post_review r
    LEFT JOIN posts p ON p.id = r.post_id
    ORDER BY r.created_at DESC LIMIT 50
  `);
  const { rows: reviewCounts } = await pool.query(`
    SELECT status, count(*)::int AS count FROM posts GROUP BY status
  `);
  res.json({ arm_stats: armStats, recent_audits: audits, review_counts: reviewCounts });
});

// Backwards compatibility aliases
app.get('/api/review/queue', requireAuth, async (req, res) => {
  req.url = '/api/posts/queue';
  app.handle(req, res);
});
app.get('/api/review/summary', requireAuth, async (req, res) => {
  req.url = '/api/posts/weekly';
  app.handle(req, res);
});

app.use('/img', express.static(IMAGE_DIR, {
  maxAge: '30d', immutable: true, index: false, dotfiles: 'deny',
}));

app.use(express.static('public'));

// Global error-handling middleware — always JSON, never HTML
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(413).json({ error: 'Too many files' });
    }
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: err.message });
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`KB on :${PORT}`);
  // Startup config summary — booleans/hosts only, no secret values.
  log.info('startup', {
    port: Number(PORT),
    image_backend: process.env.IMAGE_BACKEND ?? 'local',
    public_image_base_host: hostOnly(process.env.PUBLIC_IMAGE_BASE),
    s3_configured: Boolean(process.env.S3_KEY && process.env.S3_SECRET),
    shopee_api_configured: Boolean(process.env.SHOPEE_API_APP_ID && process.env.SHOPEE_API_SECRET),
    kb_password_set: Boolean(KB_PASSWORD),
    debug_mode: log.debugActive(),
    debug_until: process.env.DEBUG_UNTIL || null,
    log_level: process.env.LOG_LEVEL || 'info',
    node_env: process.env.NODE_ENV || null,
  });
  // Effective LLM config (host + models, never the key) — logged by getLlmConfig on change.
  try { await getLlmConfig(); } catch { /* DB may not be ready yet; logged on first real call */ }
});

startWorker(pool).catch(e => console.error('worker crashed', e));

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => pool.end().then(() => process.exit(0)));
}
