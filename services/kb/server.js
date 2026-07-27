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
import { putImage, enrich, describeImage, shortId } from './lib/products.js';

const {
  DATABASE_URL,
  PORT = 8082,
  IMAGE_DIR = '/data/images',
  KB_PASSWORD = '',
  STORAGE_DIR = '/data/pdfs',
  MAX_UPLOAD_MB = 60,
} = process.env;

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 6 });
const app = express();
app.use(express.json({ limit: '1mb' }));
app.disable('x-powered-by');

await fs.mkdir(STORAGE_DIR, { recursive: true });
await fs.mkdir(IMAGE_DIR, { recursive: true });

// ── auth: single shared password, constant-time compare, cookie session.
// Behind Cloudflare Access this is belt-and-braces, but the service can also run standalone.
function authed(req) {
  if (!KB_PASSWORD) return true;
  const cookie = (req.headers.cookie ?? '').match(/kb_session=([^;]+)/)?.[1];
  const expect = crypto.createHash('sha256').update(KB_PASSWORD).digest('hex');
  return cookie && cookie.length === expect.length &&
    crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(expect));
}
const requireAuth = (req, res, next) =>
  authed(req) ? next() : res.status(401).json({ error: 'unauthorized' });

app.post('/api/login', (req, res) => {
  if (!KB_PASSWORD || req.body?.password === KB_PASSWORD) {
    const tok = crypto.createHash('sha256').update(KB_PASSWORD).digest('hex');
    res.setHeader('set-cookie',
      `kb_session=${tok}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`);
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'wrong password' });
});

app.get('/healthz', (_, res) => res.type('text').send('ok'));

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

app.post('/api/review/:id', requireAuth, async (req, res) => {
  const { action } = req.body ?? {};   // 'insert' | 'discard'
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
  const { rows } = await pool.query(`
    SELECT id, code, name, type, instruction, example_do, example_dont,
           compatible_formats, compatible_tones, compatible_intensity,
           contested, corroboration, n, alpha, beta, cooldown_until
      FROM techniques
     WHERE enabled AND review_state <> 'rejected' AND type <> 'anti_pattern'
       AND (cooldown_until IS NULL OR cooldown_until < now())
       AND (cardinality(compatible_formats)=0 OR $1 = ANY(compatible_formats))
       AND (cardinality(compatible_tones)=0   OR $2 = ANY(compatible_tones))
       AND (cardinality(compatible_intensity)=0 OR $3::smallint = ANY(compatible_intensity))`,
    [format ?? '', tone ?? '', Number(sell_intensity ?? 1)]);
  res.json(rows);
});


// ═══════════════════════════════════════════ PRODUCT INTAKE
// The other half of the app: you add a product here, the n8n flow does the rest.

const imgUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 4 },
  fileFilter: (_, f, cb) => cb(null, /^image\/(jpeg|png)$/.test(f.mimetype)),
});

/**
 * Product intake. Three valid shapes:
 *   A) link + images
 *   B) link + images + description
 *   C) link + description            ← no images at all
 *
 * The only universally required field is the affiliate URL. Beyond that the rule is simple:
 * the system needs SOMETHING concrete to write from. Images supply it visually (via the vision
 * pass); a description supplies it in words. With neither, every post would be invented, and
 * invented copy is exactly the generic slop this whole project exists to avoid.
 */
app.post('/api/products', requireAuth, imgUpload.array('images', 4), async (req, res) => {
  const { affiliate_url, name, price_myr, notes, description } = req.body ?? {};
  const files = req.files ?? [];
  const desc = (description ?? '').trim();

  if (!affiliate_url || !/^https?:\/\//.test(affiliate_url)) {
    return res.status(400).json({ error: 'A product link is required.' });
  }

  // Exactly one image is fine (posts as a single IMAGE). Two or more may become a carousel.
  const mediaMode = files.length > 0 ? 'images' : 'text';

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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const uid = shortId(6);
    const { rows: [p] } = await client.query(
      `INSERT INTO products (uid, name, affiliate_url, description, notes, media_mode)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, uid`,
      [uid, name || null, affiliate_url, desc || null, notes || null, mediaMode]);

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const ext = f.mimetype === 'image/png' ? 'png' : 'jpg';
      const key = `${uid}/${i}-${sha256(f.buffer).slice(0, 8)}.${ext}`;
      const url = await putImage(f.buffer, key, f.mimetype);
      await client.query(
        `INSERT INTO product_images (product_id, public_url, bytes) VALUES ($1,$2,$3)`,
        [p.id, url, f.size]);
    }
    await client.query('COMMIT');

    // Enrichment and vision run AFTER the commit and are allowed to fail — the product
    // already exists and is postable. Never let an external call block the user.
    (async () => {
      try {
        const e = await enrich({ affiliateUrl: affiliate_url, name, priceIdr: price_myr,
                                 notes, description: desc, mediaMode });
        await pool.query(`UPDATE products SET name=COALESCE($2,name), enrichment=$3 WHERE id=$1`,
          [p.id, e.name ?? null, JSON.stringify(e)]);
        const { rows: imgs } = await pool.query(
          `SELECT id, public_url FROM product_images WHERE product_id=$1`, [p.id]);
        for (const im of imgs) {
          const d = await describeImage(im.public_url);
          if (d) await pool.query(`UPDATE product_images SET vision_desc=$2 WHERE id=$1`, [im.id, d]);
        }
      } catch (err) {
        await pool.query(
          `INSERT INTO run_log (workflow, level, message) VALUES ('kb_intake','warn',$1)`,
          [`enrichment failed for product ${p.uid}: ${err.message}`.slice(0, 500)]).catch(() => {});
      }
    })();

    res.json({ ok: true, product_uid: p.uid, product_id: p.id,
               images: files.length, media_mode: mediaMode });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.get('/api/products', requireAuth, async (_, res) => {
  const { rows } = await pool.query(`
    SELECT p.id, p.uid, p.name, p.status, p.affiliate_url, p.created_at,
           p.enrichment->>'price_myr' AS price_myr,
           jsonb_array_length(COALESCE(p.enrichment->'concrete_details','[]'::jsonb)) AS facts,
           p.media_mode,
           (SELECT count(*) FROM product_images pi WHERE pi.product_id=p.id) AS images,
           (SELECT count(*) FROM posts po WHERE po.product_id=p.id AND po.status='published') AS posted
      FROM products p ORDER BY p.created_at DESC LIMIT 200`);
  res.json(rows);
});

// Serve stored images publicly when IMAGE_BACKEND=local. Meta must be able to fetch these,
// so this route is intentionally NOT behind requireAuth.
app.use('/img', express.static(IMAGE_DIR, {
  maxAge: '30d', immutable: true, index: false, dotfiles: 'deny',
}));

app.use(express.static('public'));
app.listen(PORT, '0.0.0.0', () => console.log(`KB on :${PORT}`));

startWorker(pool).catch(e => console.error('worker crashed', e));

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => pool.end().then(() => process.exit(0)));
}
