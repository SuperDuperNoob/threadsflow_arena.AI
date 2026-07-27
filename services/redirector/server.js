/**
 * ThreadsFlow redirector — the single most important 100 lines in this repo.
 *
 *   GET /p/:uid   → log a click → 302 to the Shopee affiliate URL with SubId = uid
 *   GET /healthz  → ok
 *
 * Runs behind Cloudflare Tunnel on r.yourdomain.com. ~40MB RSS.
 * No framework on purpose: fewer deps, less RAM, nothing to patch.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';

const {
  DATABASE_URL,
  PORT = 8081,
  IP_SALT = 'change-me',
  FALLBACK_URL = 'https://shopee.com.my',
} = process.env;

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });

// ── bot detection: Meta's crawlers WILL hit every link you post. Counting them as clicks
//    would make every post look like it converted at 0% and poison the whole bandit.
const BOT_UA = /(facebookexternalhit|facebookcatalog|meta-externalagent|meta-externalfetcher|Threads|Instagram.*Bot|bot|crawler|spider|preview|curl|wget|python-requests|axios|HeadlessChrome|Go-http-client|Slackbot|WhatsApp|TelegramBot)/i;

// dedupe: same ip_hash + uid within 60s counts once (double-tap, prefetch, app webview reload)
const recent = new Map();
setInterval(() => {
  const cut = Date.now() - 60_000;
  for (const [k, t] of recent) if (t < cut) recent.delete(k);
}, 30_000).unref();

// in-memory cache of uid → affiliate_url (posts are immutable once published)
const linkCache = new Map();

async function resolveLink(uid) {
  if (linkCache.has(uid)) return linkCache.get(uid);
  const { rows } = await pool.query(
    `SELECT pr.affiliate_url
       FROM posts p JOIN products pr ON pr.id = p.product_id
      WHERE p.uid = $1 LIMIT 1`, [uid]);
  const url = rows[0]?.affiliate_url ?? null;
  if (url) linkCache.set(uid, url);
  return url;
}

function withSubId(url, uid) {
  try {
    const u = new URL(url);
    // Shopee affiliate accepts a single alphanumeric SubId. Works identically on
    // shopee.com.my and every other Shopee domain — the param names do not change per market.
    u.searchParams.set('sub_id', uid);
    if (!u.searchParams.has('utm_content')) u.searchParams.set('utm_content', uid);
    return u.toString();
  } catch {
    return url;
  }
}

const hashIp = ip => crypto.createHash('sha256').update(IP_SALT + ip).digest('hex').slice(0, 24);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('ok');
  }

  const m = url.pathname.match(/^\/p\/([A-Za-z0-9]{4,16})$/);
  if (!m) {
    res.writeHead(404); return res.end('not found');
  }
  const uid = m[1];

  const ua = req.headers['user-agent'] ?? '';
  const ip = (req.headers['cf-connecting-ip'] ||
              (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() ||
              req.socket.remoteAddress || '');
  const country = req.headers['cf-ipcountry'] ?? null;
  const ipHash = hashIp(ip);

  const dedupeKey = `${uid}:${ipHash}`;
  const isDupe = recent.has(dedupeKey);
  recent.set(dedupeKey, Date.now());
  const isBot = BOT_UA.test(ua) || !ua || isDupe;

  // Redirect FIRST, log after — never make the buyer wait on Postgres.
  let target = null;
  try { target = await resolveLink(uid); } catch { /* fall through */ }
  res.writeHead(302, {
    location: target ? withSubId(target, uid) : FALLBACK_URL,
    'cache-control': 'no-store, private',
    'referrer-policy': 'no-referrer',
  });
  res.end();

  pool.query(
    `INSERT INTO clicks (post_uid, ua, referer, ip_hash, country, is_bot)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [uid, ua.slice(0, 400), (req.headers.referer ?? '').slice(0, 400), ipHash, country, isBot]
  ).catch(e => console.error('click log failed', e.message));
});

server.listen(PORT, '0.0.0.0', () => console.log(`redirector on :${PORT}`));

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => pool.end().then(() => process.exit(0))));
}
