/**
 * Product intake. Lives in the KB service so there is exactly ONE web service to deploy
 * and one Cloudflare hostname to protect.
 *
 * Flow: images → public storage → vision description → enrichment → DB row.
 * Every external step degrades gracefully: if vision or enrichment fails, the product is
 * still created and posting still works, just with weaker copy. Nothing here can block you.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { complete } from './llm.js';

const {
  IMAGE_BACKEND = 'local',            // 'local' | 's3'
  PUBLIC_IMAGE_BASE = '',             // e.g. https://cdn.yourdomain.com/threadsflow
  IMAGE_DIR = '/data/images',
  S3_ENDPOINT = '', S3_BUCKET = '', S3_KEY = '', S3_SECRET = '', S3_REGION = 'auto',
} = process.env;

/** base36 short id — used as the redirect slug and the Shopee SubId (alphanumeric only). */
export const shortId = (n = 6) =>
  crypto.randomBytes(16).toString('hex').replace(/[^0-9a-f]/g, '')
    .split('').map(c => parseInt(c, 16).toString(36)).join('').slice(0, n);

// ─────────────────────────────────────────── image storage

async function putLocal(buf, key) {
  const full = path.join(IMAGE_DIR, key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buf);
  if (!PUBLIC_IMAGE_BASE) {
    throw new Error(
      'PUBLIC_IMAGE_BASE is not set. Meta fetches image_url server-side, so images must be on ' +
      'a publicly reachable HTTPS URL. Point a Cloudflare Tunnel hostname at this service and ' +
      'set PUBLIC_IMAGE_BASE=https://cdn.yourdomain.com/img');
  }
  return `${PUBLIC_IMAGE_BASE.replace(/\/$/, '')}/${key}`;
}

/** Minimal SigV4 S3 PUT — works with Cloudflare R2, MinIO, Backblaze B2. No SDK, ~40 lines. */
async function putS3(buf, key, contentType) {
  const url = new URL(`${S3_ENDPOINT.replace(/\/$/, '')}/${S3_BUCKET}/${key}`);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = crypto.createHash('sha256').update(buf).digest('hex');

  const canonicalHeaders =
    `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    'PUT', url.pathname, '', canonicalHeaders, signedHeaders, payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${S3_REGION}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');

  const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
  const signing = hmac(hmac(hmac(hmac(`AWS4${S3_SECRET}`, dateStamp), S3_REGION), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', signing).update(stringToSign).digest('hex');

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'content-type': contentType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      authorization: `AWS4-HMAC-SHA256 Credential=${S3_KEY}/${scope}, ` +
                     `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: buf,
  });
  if (!res.ok) throw new Error(`S3 upload ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return `${PUBLIC_IMAGE_BASE.replace(/\/$/, '')}/${key}`;
}

export const putImage = (buf, key, ct) =>
  IMAGE_BACKEND === 's3' ? putS3(buf, key, ct) : putLocal(buf, key);

// ─────────────────────────────────────────── enrichment

/**
 * Enrichment is best-effort. It reads the affiliate page's OpenGraph tags — no Apify needed,
 * no API key, no cost. If the page blocks us (Shopee often does), we fall back to whatever the
 * user typed. The system must never be blocked by an external site.
 */
export async function enrich({ affiliateUrl, name, priceIdr, notes }) {
  let og = {};
  try {
    const res = await fetch(affiliateUrl, {
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; ThreadsFlow/1.0)' },
      signal: AbortSignal.timeout(12_000),
    });
    const html = (await res.text()).slice(0, 200_000);
    const pick = p => html.match(new RegExp(`<meta[^>]+property=["']og:${p}["'][^>]+content=["']([^"']+)`, 'i'))?.[1];
    og = { title: pick('title'), description: pick('description'), image: pick('image') };
  } catch { /* Shopee blocks datacenter IPs routinely — expected, not an error */ }

  const base = {
    name: name || og.title || null,
    price_idr: priceIdr ? Number(priceIdr) : null,
    og_description: og.description ?? null,
  };

  // Turn whatever we have — mostly the user's notes — into the 5 concrete details the
  // writer prompt requires. This is the step that stops copy from sounding generic.
  try {
    const out = await complete(
      `You prepare product facts for a copywriter. Output JSON only:
{"name":"","category":"","target_persona":"","price_idr":null,
 "concrete_details":["5 concrete checkable facts: measurements, materials, durations, prices, quantities"],
 "top_reviews":["up to 3 short realistic buyer phrases, ONLY if present in the input; otherwise empty array"]}

Rules:
- NEVER invent a review. Empty array is correct if none were supplied.
- concrete_details must be checkable facts, not adjectives. "11cm handle" yes. "ergonomic" no.
- If you have fewer than 5 real facts, return fewer. Do not pad.
- Write in Indonesian.`,
      JSON.stringify({ url: affiliateUrl, og, user_name: name, user_price: priceIdr, user_notes: notes }),
      { temperature: 0.2 });
    return { ...base, ...out, enriched: true };
  } catch {
    // total fallback: split the user's notes into details. Still works.
    return {
      ...base,
      concrete_details: (notes || '').split(/[.\n;]+/).map(s => s.trim()).filter(s => s.length > 8).slice(0, 5),
      top_reviews: [],
      enriched: false,
    };
  }
}

/** Describe an image so the copy matches the photo it's attached to. Best-effort. */
export async function describeImage(publicUrl) {
  try {
    const out = await complete(
      'Describe literally what is visible in this product photo in ONE Indonesian sentence. ' +
      'Mention colour, setting, lighting and framing. Output JSON {"desc":""}.',
      `Image URL: ${publicUrl}`, { temperature: 0.2 });
    return out.desc ?? null;
  } catch { return null; }
}
