/**
 * ThreadsFlow redirector — v2 stealth fingerprint redirector.
 *
 *   GET  /p/:uid    → 302 to the Shopee affiliate URL with SubId = uid
 *   GET  /ping.js   → tiny browser probe script (best-effort race condition)
 *   POST /ping      → browser fingerprint beacon; upgrades/downgrades latest click
 *   GET  /healthz   → ok
 *
 * The buyer gets a normal 302 immediately after link resolution. There is no visible
 * "Loading Shopee..." bridge page and no window.location.replace for bots to wait on.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';
import { createLogger, hostOnly, snippet } from './logger.js';

const {
  DATABASE_URL,
  PORT = 8081,
  IP_SALT = 'change-me',
  FALLBACK_URL = 'https://shopee.com.my',
} = process.env;

const log = createLogger('redirector');

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });

// ── bot detection: Meta's crawlers WILL hit every link you post. Counting them as clicks
//    would make every post look like it converted at 0% and poison the whole bandit.
const BOT_UA = /(facebookexternalhit|facebookcatalog|meta-externalagent|meta-externalfetcher|ThreadsBot|Instagram.*Bot|bot|crawler|spider|preview|curl|wget|python-requests|axios|HeadlessChrome|Go-http-client|Slackbot|WhatsApp|TelegramBot)/i;
const MOBILE_UA = /(iPhone|iPad|Android|Mobile|Threads|Instagram)/i;

// dedupe: same ip_hash + uid within 60s counts once (double-tap, prefetch, app webview reload)
const recent = new Map();
setInterval(() => {
  const cut = Date.now() - 60_000;
  for (const [k, t] of recent) if (t < cut) recent.delete(k);
}, 30_000).unref();

// short-lived nonce map for race-condition pingbacks
const pending = new Map();
setInterval(() => {
  const cut = Date.now() - 180_000;
  for (const [k, v] of pending) if (v.ts < cut) pending.delete(k);
}, 60_000).unref();

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
const nonce = () => crypto.randomBytes(12).toString('base64url');
const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

function clientIp(req) {
  return (req.headers['cf-connecting-ip'] ||
          (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() ||
          req.socket.remoteAddress || '');
}

function clampText(v, n) {
  return String(v ?? '').slice(0, n);
}

async function readJson(req, limit = 8192) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function fingerprintVerdict({ fp, ua, headers }) {
  let score = 0;
  const reasons = [];
  const mobile = MOBILE_UA.test(ua);

  if (!ua) { score -= 3; reasons.push('missing_ua'); }
  if (BOT_UA.test(ua)) { score -= 5; reasons.push('bot_ua'); }
  if (/HeadlessChrome|PhantomJS|Playwright|Puppeteer/i.test(ua)) { score -= 5; reasons.push('headless_ua'); }
  if (fp.webdriver === true) { score -= 6; reasons.push('webdriver_true'); }

  const sw = Number(fp.screen?.w ?? fp.screen?.width ?? fp.w);
  const sh = Number(fp.screen?.h ?? fp.screen?.height ?? fp.h);
  const dpr = Number(fp.screen?.dpr ?? fp.dpr);
  if (sw >= 300 && sh >= 500 && sw <= 5000 && sh <= 5000) score += 2;
  else { score -= 2; reasons.push('bad_screen'); }
  if (dpr >= 1 && dpr <= 4.5) score += 1;
  else reasons.push('bad_dpr');

  const touch = Number(fp.maxTouchPoints ?? fp.touch ?? 0);
  if (mobile && touch > 0) score += 2;
  if (mobile && touch === 0) { score -= 2; reasons.push('mobile_without_touch'); }

  const hw = Number(fp.hardwareConcurrency ?? 0);
  if (hw > 0 && hw <= 32) score += 1;
  else reasons.push('missing_hw');

  if (Array.isArray(fp.languages) && fp.languages.length) score += 1;
  else if (fp.language) score += 0.5;
  else reasons.push('missing_language');

  if (fp.timezone) score += 1;
  else reasons.push('missing_timezone');

  // Battery is not universally exposed (notably iOS), so absence is not a hard bot signal.
  // If it is exposed, real mobile browsers return sane values; many headless stacks forget it.
  if (fp.battery && Number.isFinite(Number(fp.battery.level))) {
    const level = Number(fp.battery.level);
    if (level >= 0 && level <= 1 && typeof fp.battery.charging === 'boolean') score += 1;
    else { score -= 1; reasons.push('bad_battery'); }
  } else if (!mobile) {
    reasons.push('no_battery');
  }

  const secFetchSite = headers['sec-fetch-site'];
  const secFetchMode = headers['sec-fetch-mode'];
  if (secFetchSite || secFetchMode) score += 0.5;
  if (/HeadlessChrome/i.test(headers['sec-ch-ua'] ?? '')) { score -= 4; reasons.push('headless_ch_ua'); }

  return {
    score: Math.round(score * 10) / 10,
    is_bot: score < 3,
    reason: reasons.length ? reasons.join(',') : 'verified_browser',
  };
}

async function updateClickFingerprint({ uid, ipHash, clickId, isBot, reason, score, fp }) {
  const fpJson = JSON.stringify(fp).slice(0, 6000);
  const updateSql = clickId
    ? `UPDATE clicks SET is_bot=$1, bot_reason=$2, fingerprint=$3::jsonb,
              fingerprint_score=$4, pinged_at=now()
        WHERE id=$5`
    : `UPDATE clicks SET is_bot=$1, bot_reason=$2, fingerprint=$3::jsonb,
              fingerprint_score=$4, pinged_at=now()
        WHERE id = (
          SELECT id FROM clicks
           WHERE post_uid=$5 AND ip_hash=$6 AND ts > now() - interval '3 minutes'
           ORDER BY ts DESC LIMIT 1
        )`;
  const params = clickId
    ? [isBot, reason, fpJson, Math.round(score), clickId]
    : [isBot, reason, fpJson, Math.round(score), uid, ipHash];

  try {
    let r = await pool.query(updateSql, params);
    // The beacon can beat the async INSERT by a few milliseconds. Retry once by natural key.
    if (r.rowCount === 0 && clickId) {
      await new Promise(resolve => setTimeout(resolve, 150));
      r = await pool.query(
        `UPDATE clicks SET is_bot=$1, bot_reason=$2, fingerprint=$3::jsonb,
                fingerprint_score=$4, pinged_at=now()
          WHERE id = (
            SELECT id FROM clicks
             WHERE post_uid=$5 AND ip_hash=$6 AND ts > now() - interval '3 minutes'
             ORDER BY ts DESC LIMIT 1
          )`, [isBot, reason, fpJson, Math.round(score), uid, ipHash]);
    }
    return r.rowCount;
  } catch (e) {
    // Backwards-compatible fallback if the DB migration has not run yet.
    if (/bot_reason|fingerprint|pinged_at|fingerprint_score/i.test(e.message)) {
      const r = await pool.query(
        `UPDATE clicks SET is_bot=$1
          WHERE id = (
            SELECT id FROM clicks
             WHERE post_uid=$2 AND ip_hash=$3 AND ts > now() - interval '3 minutes'
             ORDER BY ts DESC LIMIT 1
          )`, [isBot, uid, ipHash]);
      return r.rowCount;
    }
    throw e;
  }
}

function pingScript(uid, n) {
  // Plain JS only; no third-party pixels. It runs only in a real browser/WebView context.
  return `(()=>{const uid=${JSON.stringify(uid)},n=${JSON.stringify(n)};const t=(p,ms)=>Promise.race([p,new Promise(r=>setTimeout(()=>r(null),ms))]);(async()=>{try{const b=typeof navigator.getBattery==='function'?await t(navigator.getBattery(),250):null;const fp={uid,nonce:n,screen:{w:screen.width,h:screen.height,aw:screen.availWidth,ah:screen.availHeight,dpr:devicePixelRatio||1,orientation:screen.orientation&&screen.orientation.type},timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,language:navigator.language,languages:navigator.languages,platform:navigator.platform,vendor:navigator.vendor,webdriver:navigator.webdriver===true,hardwareConcurrency:navigator.hardwareConcurrency||0,deviceMemory:navigator.deviceMemory||0,maxTouchPoints:navigator.maxTouchPoints||0,battery:b?{level:b.level,charging:b.charging}:null};const body=JSON.stringify(fp);if(navigator.sendBeacon){const ok=navigator.sendBeacon('/ping',new Blob([body],{type:'application/json'}));if(ok)return;}fetch('/ping',{method:'POST',headers:{'content-type':'application/json'},body,keepalive:true,credentials:'omit'}).catch(()=>{});}catch(e){}})();})();`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/healthz') {
    log.debug('healthz_hit', {});     // debug only — health probes would flood info logs
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('ok');
  }

  if (url.pathname === '/ping.js') {
    const uid = clampText(url.searchParams.get('uid'), 32);
    const n = clampText(url.searchParams.get('n'), 64);
    log.debug('ping_js_served', { uid });
    res.writeHead(200, {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'no-store, private',
      'x-content-type-options': 'nosniff',
    });
    return res.end(pingScript(uid, n));
  }

  if (url.pathname === '/ping') {
    if (req.method === 'GET') {
      // Link rel=prefetch probe. Useful as a weak browser hint but not enough to mark human.
      res.writeHead(204, { 'cache-control': 'no-store, private' });
      return res.end();
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST, GET' });
      return res.end('method not allowed');
    }

    try {
      const fp = await readJson(req);
      const uid = clampText(fp.uid, 32);
      const n = clampText(fp.nonce, 64);
      const ipHash = hashIp(clientIp(req));
      const pendingHit = pending.get(n);
      const ua = req.headers['user-agent'] ?? pendingHit?.ua ?? '';

      if (!uid || !n || !pendingHit || pendingHit.uid !== uid || pendingHit.ipHash !== ipHash) {
        log.debug('ping_rejected', { uid, reason: 'stale_or_bad_nonce' });
        return json(res, 202, { ok: false, reason: 'stale_or_bad_nonce' });
      }

      const verdict = fingerprintVerdict({ fp, ua, headers: req.headers });
      const rowCount = await updateClickFingerprint({
        uid, ipHash, clickId: pendingHit.clickId,
        isBot: verdict.is_bot, reason: verdict.reason, score: verdict.score, fp,
      });
      if (rowCount > 0) pending.delete(n);
      // Verdict reason + score are safe; raw fingerprint only at debug, truncated + sanitized.
      log.info('ping_verified', {
        uid, verified: !verdict.is_bot, score: verdict.score,
        reason: verdict.reason, click_updated: rowCount > 0,
      });
      log.debug('ping_fingerprint', { uid, fp_snippet: snippet(JSON.stringify(fp), 300) });
      return json(res, 202, { ok: true, verified: !verdict.is_bot });
    } catch (e) {
      console.error('ping failed', e.message);
      log.warn('ping_failed', { reason: e.message });
      return json(res, 202, { ok: false });
    }
  }

  const m = url.pathname.match(/^\/p\/([A-Za-z0-9]{4,16})$/);
  if (!m) {
    res.writeHead(404); return res.end('not found');
  }
  const uid = m[1];

  const ua = req.headers['user-agent'] ?? '';
  const ip = clientIp(req);
  const country = req.headers['cf-ipcountry'] ?? null;
  const ipHash = hashIp(ip);

  const dedupeKey = `${uid}:${ipHash}`;
  const isDupe = recent.has(dedupeKey);
  recent.set(dedupeKey, Date.now());
  const firstPassBot = BOT_UA.test(ua) || !ua || isDupe;
  const botReason = firstPassBot ? (isDupe ? 'dedupe' : (!ua ? 'missing_ua' : 'bot_ua')) : 'awaiting_browser_ping';
  const n = nonce();
  pending.set(n, { uid, ipHash, ua, ts: Date.now() });

  // Resolve target, then redirect with no human-visible bridge. The Link header + Early Hints are
  // a best-effort race: real browsers may fetch the probe while bots that only follow redirects
  // never see a JS challenge to wait on.
  let target = null;
  try { target = await resolveLink(uid); } catch (e) { log.warn('resolve_link_failed', { uid, reason: e.message }); }
  const location = target ? withSubId(target, uid) : FALLBACK_URL;

  // Host only — the full affiliate URL carries SubIds/tracking params and stays out of logs.
  log.info('redirect_hit', {
    uid, found: Boolean(target), target_host: hostOnly(location),
    first_pass: firstPassBot ? 'bot' : 'human', bot_reason: botReason,
    country, dedupe: isDupe,
  });
  const probe = `/ping.js?uid=${encodeURIComponent(uid)}&n=${encodeURIComponent(n)}`;
  const prefetch = `/ping?uid=${encodeURIComponent(uid)}&n=${encodeURIComponent(n)}&probe=1`;

  if (typeof res.writeEarlyHints === 'function') {
    try { res.writeEarlyHints({ link: `<${probe}>; rel=preload; as=script` }); } catch { /* ignore */ }
  }

  res.writeHead(302, {
    location,
    link: `<${probe}>; rel=preload; as=script, <${prefetch}>; rel=prefetch; as=fetch`,
    'cache-control': 'no-store, private',
    'clear-site-data': '"cache"',
    'referrer-policy': 'no-referrer',
    'x-robots-tag': 'noindex, nofollow',
    'content-type': 'text/html; charset=utf-8',
  });
  res.end(`<!doctype html><meta name="robots" content="noindex"><script src="${probe}" async></script>`);

  pool.query(
    `INSERT INTO clicks (post_uid, ua, referer, ip_hash, country, is_bot, bot_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [uid, ua.slice(0, 400), (req.headers.referer ?? '').slice(0, 400), ipHash, country, firstPassBot, botReason]
  ).then(r => {
    const hit = pending.get(n);
    if (hit) hit.clickId = r.rows[0]?.id;
    log.debug('click_insert_ok', { uid, click_id: r.rows[0]?.id ?? null });
  }).catch(async e => {
    if (/bot_reason/i.test(e.message)) {
      return pool.query(
        `INSERT INTO clicks (post_uid, ua, referer, ip_hash, country, is_bot)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [uid, ua.slice(0, 400), (req.headers.referer ?? '').slice(0, 400), ipHash, country, firstPassBot]
      ).then(r => {
        const hit = pending.get(n);
        if (hit) hit.clickId = r.rows[0]?.id;
        log.debug('click_insert_ok', { uid, click_id: r.rows[0]?.id ?? null, fallback: true });
      }).catch(e2 => { console.error('click log failed', e2.message); log.error('click_insert_failed', { uid, reason: e2.message }); });
    }
    console.error('click log failed', e.message);
    log.error('click_insert_failed', { uid, reason: e.message });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`redirector on :${PORT}`);
  log.info('startup', {
    port: Number(PORT),
    fallback_host: hostOnly(FALLBACK_URL),
    ip_salt_set: IP_SALT !== 'change-me',
    debug_mode: log.debugActive(),
    debug_until: process.env.DEBUG_UNTIL || null,
    log_level: process.env.LOG_LEVEL || 'info',
  });
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => pool.end().then(() => process.exit(0))));
}
