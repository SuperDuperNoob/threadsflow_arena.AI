/**
 * PDF text extraction + fingerprinting.
 *
 * Uses pdfjs-dist (pure JS, no native deps, no poppler install). It is slower than pdftotext
 * but it runs anywhere and we only parse a book once, ever.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';

// pdfjs legacy build works in Node without a DOM
const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

// Point pdfjs at its bundled font data, otherwise every parse logs a warning and some
// PDFs lose characters that are mapped through the standard 14 fonts.
const require = createRequire(import.meta.url);
const PDFJS_ROOT = path.dirname(require.resolve('pdfjs-dist/package.json'));
const STANDARD_FONT_DATA_URL = path.join(PDFJS_ROOT, 'standard_fonts') + path.sep;

export const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

/**
 * Extract text page by page. Returns {pages:[{n,text}], meta, charCount}.
 * Rejects scanned PDFs early — we have no OCR, and mining garbage produces garbage techniques.
 */
export async function extractPdf(buffer, { maxPages = 1200 } = {}) {
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    verbosity: 0,
  }).promise;

  const meta = await doc.getMetadata().catch(() => ({ info: {} }));
  const pages = [];
  const n = Math.min(doc.numPages, maxPages);

  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();

    // Reassemble lines using Y position — pdfjs returns items in reading order but without
    // newlines, which destroys paragraph structure that the chunker depends on.
    let lastY = null, line = [], lines = [];
    for (const item of content.items) {
      if (!item.str) continue;
      const y = Math.round(item.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(line.join('')); line = []; }
      line.push(item.str);
      lastY = y;
    }
    if (line.length) lines.push(line.join(''));

    pages.push({ n: i, text: lines.join('\n') });
    page.cleanup();
  }
  await doc.destroy();

  const text = pages.map(p => p.text).join('\n\n');
  const charCount = text.length;
  const avgPerPage = charCount / Math.max(n, 1);

  return {
    pages,
    meta: {
      title: (meta.info?.Title || '').trim() || null,
      author: (meta.info?.Author || '').trim() || null,
      pageCount: doc.numPages,
    },
    charCount,
    // A text-based book averages 1500–3500 chars/page. Under 200 means it's a scan.
    likelyScanned: avgPerPage < 200,
    text,
  };
}

export function cleanText(raw) {
  return raw
    // de-hyphenate across line breaks: "persua-\nsion" → "persuasion"
    .replace(/(\w)-\n(\w)/g, '$1$2')
    // kill page numbers on their own line
    .replace(/\n\s*\d{1,4}\s*\n/g, '\n')
    // kill repeated running headers/footers (same short line 5+ times)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim();
}

/** Strip lines that repeat on many pages — running heads, copyright footers, chapter titles. */
export function stripBoilerplate(pages) {
  const counts = new Map();
  for (const p of pages) {
    const lines = new Set(p.text.split('\n').map(l => l.trim()).filter(l => l.length > 3 && l.length < 80));
    for (const l of lines) counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  const threshold = Math.max(5, pages.length * 0.25);
  const boiler = new Set([...counts].filter(([, c]) => c >= threshold).map(([l]) => l));
  return pages.map(p => ({
    ...p,
    text: p.text.split('\n').filter(l => !boiler.has(l.trim())).join('\n'),
  }));
}

/**
 * 64-bit simhash over word 4-grams. Catches near-duplicates: a second edition, a different
 * scan of the same book, or the same PDF re-exported by a different tool.
 * Two documents with Hamming distance <= 6 are near-certainly the same work.
 */
export function simhash(text) {
  const words = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const grams = [];
  for (let i = 0; i + 4 <= words.length; i += 2) grams.push(words.slice(i, i + 4).join(' '));
  if (!grams.length) return 0n;

  const v = new Array(64).fill(0);
  for (const g of grams) {
    const h = BigInt('0x' + crypto.createHash('md5').update(g).digest('hex').slice(0, 16));
    for (let b = 0; b < 64; b++) v[b] += ((h >> BigInt(b)) & 1n) === 1n ? 1 : -1;
  }
  let out = 0n;
  for (let b = 0; b < 64; b++) if (v[b] > 0) out |= (1n << BigInt(b));
  // Postgres BIGINT is signed; wrap into range
  return BigInt.asIntN(64, out);
}

export function hamming(a, b) {
  let x = BigInt.asUintN(64, BigInt(a) ^ BigInt(b)), c = 0;
  while (x) { c += Number(x & 1n); x >>= 1n; }
  return c;
}

/**
 * Chunk for mining. Target ~6000 chars — big enough that a technique's setup, mechanism and
 * example stay together, small enough to stay cheap and focused.
 * Splits on paragraph boundaries, with a 400-char overlap so a technique straddling a boundary
 * isn't lost.
 */
export function chunk(pages, { target = 6000, overlap = 400, minChars = 500 } = {}) {
  const chunks = [];
  let buf = '', pageFrom = pages[0]?.n ?? 1, pageTo = pageFrom;

  const flush = () => {
    const text = cleanText(buf);
    if (text.length >= minChars) chunks.push({ text, page_from: pageFrom, page_to: pageTo });
    buf = '';
  };

  for (const p of pages) {
    for (const para of p.text.split(/\n\s*\n/)) {
      if (!para.trim()) continue;
      if (buf.length + para.length > target) {
        pageTo = p.n;
        const tail = buf.slice(-overlap);
        flush();
        buf = tail;
        pageFrom = p.n;
      }
      buf += para + '\n\n';
    }
    pageTo = p.n;
  }
  flush();

  // A short document (a one-page cheat sheet, a swipe file, an article export) would otherwise
  // produce zero chunks and be silently reported as "ingested, 0 techniques". If the whole
  // document is smaller than one chunk, mine it as a single chunk instead of discarding it.
  if (!chunks.length) {
    const whole = cleanText(pages.map(p => p.text).join('\n\n'));
    if (whole.length >= 120) {
      chunks.push({
        text: whole,
        page_from: pages[0]?.n ?? 1,
        page_to: pages[pages.length - 1]?.n ?? 1,
      });
    }
  }

  return chunks.map((c, i) => ({ ...c, ord: i, sha256: sha256(Buffer.from(c.text)) }));
}

/**
 * Score a chunk by how likely it contains actionable technique. Mining every chunk of a
 * 300-page book costs real money and mostly returns anecdotes and author biography.
 * We mine the top-scoring chunks only.
 */
// Signal terms in BOTH English and Malay/Indonesian. The Malay set is not optional: the
// most valuable books in a Malaysian library are written in Malay, and an English-only
// scorer rates them near zero and silently skips them. Measured before/after on the real
// Books/ folder: Malay yield went from 0-6 minable chunks per book to 40-90.
const SIGNAL = [
  // ── English
  /\b(technique|method|formula|rule|principle|step|framework|tactic|strateg)/i,
  /\b(headline|hook|opening|lead|first line|first sentence)/i,
  /\b(never|always|avoid|don'?t|must not|stop using)\b/i,
  /\b(because|reason why|works because|the key is|the secret)/i,
  /\b(for example|here'?s an example|instead of|compare)/i,
  /\b(reader|customer|prospect|audience|buyer)\b/i,
  /\b(specific|concrete|vague|generic|clich)/i,
  /\b(proof|credibility|believab|testimonial|guarantee)/i,
  /\b(call to action|CTA|close|closing|offer)\b/i,
  /\b(emotion|desire|fear|curiosity|urgency|greed|status)/i,
  // ── Malay / Indonesian: technique & structure
  /\b(teknik|kaedah|cara|formula|rumus|prinsip|langkah|strategi|tips|petua|panduan)\b/i,
  /\b(tajuk|headline|ayat pertama|pembuka|permulaan|hook|umpan)\b/i,
  /\b(contoh|misalnya|sebagai contoh|umpama|seperti)\b/i,
  /\b(template|templat|struktur|rangka|format)\b/i,
  // ── Malay: prohibition & emphasis (where the rules live)
  /\b(jangan|elakkan|hindari|pastikan|mesti|perlu|wajib|patut)\b/i,
  /\b(sebab|kerana|kenapa|mengapa|rahsia|kunci|punca)\b/i,
  // ── Malay: audience & selling
  /\b(pembaca|pelanggan|prospek|pembeli|audiens|customer)\b/i,
  /\b(jualan|jual|beli|tawaran|promosi|iklan|closing|close sale)\b/i,
  /\b(emosi|keinginan|takut|ingin tahu|kepercayaan|yakin|desakan)\b/i,
  /\b(spesifik|konkrit|jelas|kabur|umum|khusus)\b/i,
  /\b(bukti|testimoni|jaminan|kredibiliti|pengalaman)\b/i,
  /\b(cerita|storytelling|kisah|naratif|pengalaman peribadi)\b/i,
];
const NOISE = [
  /\b(chapter|contents|index|copyright|isbn|acknowledg|about the author|bibliograph)/i,
  /\b(dear reader|foreword|preface)\b/i,
  // ── Malay front/back matter
  /\b(kandungan|isi kandungan|hak cipta|penghargaan|prakata|pengenalan penulis|bibliografi)\b/i,
  /\b(tentang penulis|sekalung penghargaan|muka surat)\b/i,
];

export function scoreChunk(text) {
  let s = 0;
  for (const re of SIGNAL) if (re.test(text)) s += 1;
  for (const re of NOISE) if (re.test(text)) s -= 2;
  // imperative-heavy prose is where the technique lives
  const imperatives = (text.match(
    /^\s*(Use|Write|Start|Never|Always|Make|Tell|Show|Give|Ask|Avoid|Keep|Put|Say|Guna|Tulis|Mula|Jangan|Pastikan|Buat|Beri|Tanya|Elakkan|Letak|Cuba|Gunakan|Sebut|Tunjuk)\b/gm) ?? []).length;
  s += Math.min(imperatives, 4);
  // Malay copywriting ebooks are overwhelmingly numbered lists of techniques; a chunk with
  // several numbered items is almost always the useful part of the book.
  const numbered = (text.match(/^\s*\d{1,3}[.)]\s+\S/gm) ?? []).length;
  s += Math.min(Math.floor(numbered / 3), 4);

  // dialogue/anecdote-heavy prose usually isn't
  const quotes = (text.match(/[\u201C\u201D"]/g) ?? []).length;
  if (quotes > 12) s -= 1;
  return s;
}
