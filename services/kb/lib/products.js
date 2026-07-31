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
import { enrichProductFromShopee } from './shopee.js';

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

/** Minimal SigV4 S3 PUT — works with Cloudflare R2, Backblaze B2, MinIO. No SDK, ~45 lines.
 *
 *  SIGV4 PATH-ENCODING GOTCHA: the canonical request must use the *encoded* path
 *  (RFC 3986, §3.4), but `new URL().pathname` returns the *decoded* form.
 *  If `key` contains spaces, `+`, `%`, or non-ASCII bytes, the signature computed
 *  from the decoded path will not match what the server expects and every request
 *  will return 403 SignatureDoesNotMatch.  We construct the encoded path before
 *  building the URL so both the fetch target and the signing string agree.
 */
async function putS3(buf, key, contentType) {
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  const endpoint = S3_ENDPOINT.replace(/\/$/, '');
  const path   = `/${S3_BUCKET}/${encodedKey}`;
  const url    = new URL(`${endpoint}${path}`);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = crypto.createHash('sha256').update(buf).digest('hex');

  const canonicalHeaders =
    `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    'PUT', path, '', canonicalHeaders, signedHeaders, payloadHash,
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

/** Determine media_kind from mimetype. */
export const getMediaKind = (mimetype) =>
  /^video\/(mp4|quicktime)$/.test(mimetype) ? 'VIDEO' : 'IMAGE';

/** Get file extension from mimetype. */
export const getExtension = (mimetype) => {
  if (mimetype === 'image/png') return 'png';
  if (mimetype === 'image/jpeg') return 'jpg';
  if (mimetype === 'video/mp4') return 'mp4';
  if (mimetype === 'video/quicktime') return 'mov';
  return 'bin';
};

// ─────────────────────────────────────────── enrichment

/**
 * Enrichment is best-effort. `affiliateUrl` is always the money link used for buyer redirects.
 * `productUrl`, when supplied, is the plain Shopee product URL used only to identify/enrich the
 * product (short affiliate links often hide the item id). When Shopee Open API keys are
 * configured, price + commission come from productOfferV2 (authoritative, no scraper, no cost).
 * Otherwise — or if the API call fails — it falls back to OpenGraph tags. Either way it must
 * never block the user.
 */
export async function enrich({ affiliateUrl, productUrl = '', name, priceIdr, notes, description = '', mediaMode = 'images' }) {
  const lookupUrl = productUrl || affiliateUrl;

  // Best-effort authoritative enrichment from the Shopee Affiliate Open API. Use the optional
  // full product URL first because it exposes `/product/<shop>/<item>` or `/i.<shop>.<item>`;
  // the affiliate short URL should remain untouched for buyer redirects and commission tracking.
  let shopee = null;
  try {
    shopee = await enrichProductFromShopee(lookupUrl, { name });
  } catch { /* enrichment is optional — fall through to scraping/fallback */ }

  let og = {};
  const ogUrls = [...new Set([productUrl, affiliateUrl].filter(Boolean))];
  for (const url of ogUrls) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; ThreadsFlow/1.0)' },
        signal: AbortSignal.timeout(12_000),
      });
      const html = (await res.text()).slice(0, 200_000);
      const pick = p => html.match(new RegExp(`<meta[^>]+property=["']og:${p}["'][^>]+content=["']([^"']+)`, 'i'))?.[1];
      og = { title: pick('title'), description: pick('description'), image: pick('image'), source_url: url };
      if (og.title || og.description || og.image) break;
    } catch { /* Shopee blocks datacenter IPs routinely — expected, not an error */ }
  }

  const base = {
    name: name || shopee?.name || og.title || null,
    price_myr: priceIdr ? Number(priceIdr) : (shopee?.price_min ?? null),
    og_description: og.description ?? null,
    media_mode: mediaMode,
    product_url: productUrl || null,
    enrichment_url: lookupUrl,
    // Shopee Open API enrichment fields (null unless the API is configured and matched)
    shopee_source: shopee?.ok ? 'shopee_openapi' : (og.title || og.description ? 'og' : 'none'),
    shopee_item_id: shopee?.item_id ?? null,
    shopee_commission_rate: shopee?.commission_rate ?? null,
    shopee_commission: shopee?.commission ?? null,
    shopee_sales: shopee?.sales ?? null,
    shopee_rating: shopee?.rating ?? null,
    shopee_offer_link: shopee?.offer_link ?? null,
  };

  // With no images there is no vision pass, so concrete_details is the ONLY specificity the
  // writer will ever see. Demand more of it and make the model say so when it falls short,
  // rather than quietly padding the list with adjectives.
  const textOnly = mediaMode === 'text';

  // Turn whatever we have — mostly the user's notes — into the 5 concrete details the
  // writer prompt requires. This is the step that stops copy from sounding generic.
  try {
    const out = await complete(
      `You prepare product facts for a copywriter. Output JSON only:
{"name":"","category":"","target_persona":"","price_myr":null,
 "concrete_details":["concrete checkable facts: measurements, materials, durations, prices, quantities"],
 "sensory_details":["${textOnly ? '3-5 physical details someone could see or feel: colour, texture, size relative to a hand, weight, sound' : 'leave empty'}"],
 "top_reviews":["up to 3 short realistic buyer phrases, ONLY if present in the input; otherwise empty array"],
 "detail_confidence":"high|low"}

Rules:
- NEVER invent a review. Empty array is correct if none were supplied.
- concrete_details must be checkable facts, not adjectives. "gagang 11cm" yes. "ergonomis" no.
- Extract ONLY from the supplied text. Do not add facts from general knowledge about the
  product category. A wrong specific is worse than a missing one.
- If you have fewer than 5 real facts, return fewer and set detail_confidence="low". Do not pad.
${textOnly
  ? '- THERE ARE NO PHOTOS. sensory_details is what the writer uses in place of an image, so it ' +
    'matters more than usual. Derive it ONLY from the description; if the description does not ' +
    'support it, return an empty array and set detail_confidence="low".'
  : '- Photos exist and are described separately. Leave sensory_details empty.'}
- Write in Malaysian Malay (tak, nak, dah, je, lah). Currency RM. Never Indonesian.`,
      JSON.stringify({ affiliate_url: affiliateUrl, product_url: productUrl || null,
                       enrichment_url: lookupUrl, og, user_name: name, user_price: priceIdr,
                       user_notes: notes, user_description: description,
                       shopee: shopee?.ok ? {
                         price_min: shopee.price_min, price_max: shopee.price_max,
                         commission_rate: shopee.commission_rate, sales: shopee.sales,
                         rating: shopee.rating,
                       } : null }),
      { temperature: 0.2 });
    return { ...base, ...out, enriched: true };
  } catch {
    // Total fallback: split whatever free text we have into details. Still works — the
    // description is usually already written in sentences, which is exactly the right shape.
    return {
      ...base,
      concrete_details: `${description}\n${notes || ''}`
        .split(/[.\n;]+/).map(x => x.trim()).filter(x => x.length > 8).slice(0, 6),
      sensory_details: [],
      top_reviews: [],
      detail_confidence: 'low',
      enriched: false,
    };
  }
}

/** Describe an image so the copy matches the photo it's attached to. Best-effort. */
export async function describeImage(publicUrl, mediaKind = 'IMAGE') {
  // Skip vision for videos — LLM vision endpoints do not support video yet.
  if (mediaKind === 'VIDEO') return null;
  try {
    const out = await complete(
      'Describe literally what is visible in this product photo in ONE Malay sentence. ' +
      'Mention colour, setting, lighting and framing. Output JSON {"desc":""}.',
      `Image URL: ${publicUrl}`, { temperature: 0.2 });
    return out.desc ?? null;
  } catch { return null; }
}
