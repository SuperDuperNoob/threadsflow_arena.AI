/**
 * Tiny structured JSON logger for ThreadsFlow services.
 *
 * One line of JSON per event on stdout (errors on stderr) so `docker compose logs`
 * stays grep-able and the json-file log driver can rotate it.
 *
 * Debug semantics (72h canary mode):
 *   - LOG_LEVEL   controls the minimum level: debug | info | warn | error (default info)
 *   - DEBUG_MODE  must be "true" for debug-level events to be emitted at all
 *   - DEBUG_UNTIL optional ISO timestamp; once the clock passes it, debug behaves
 *     as disabled automatically — no redeploy needed to end the canary window.
 *
 * Secret hygiene — this logger MASKS, it does not trust callers:
 *   - object keys matching api_key/token/secret/password/authorization/... → "***"
 *   - strings that look like API keys, Bearer tokens or Meta/Threads tokens → "***"
 *   - URL query strings are dropped (affiliate URLs carry tracking ids/SubIds)
 *   - ?access_token=... style params inside longer text are masked
 *   - long strings are truncated (generated text should be cut via snippet(text, 120))
 *
 * NOTE: services/redirector/logger.js is a byte-identical copy of this file — the two
 * services have separate Docker build contexts. If you change one, change both.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

/** true only when DEBUG_MODE=true and DEBUG_UNTIL (if set) has not passed. */
export function debugActive(env = process.env) {
  if (String(env.DEBUG_MODE ?? '').toLowerCase() !== 'true') return false;
  const until = String(env.DEBUG_UNTIL ?? '').trim();
  if (!until) return true;
  const t = Date.parse(until);
  if (Number.isNaN(t)) return true;      // unparseable timestamp → treat as "no expiry"
  return Date.now() <= t;
}

const SECRET_KEY_RE =
  /(api[_-]?key|apikey|secret|token|password|passwd|authorization|bearer|cookie|session|credential|signature|private[_-]?key)/i;

const SECRET_VALUE_PATTERNS = [
  [/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{10,}\b/g, '***'],                   // OpenAI-style keys
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer ***'],             // auth headers
  [/\b(?:EAA|THAA|IGQV|IGAA)[A-Za-z0-9_-]{16,}/g, '***'],            // Meta / Threads / IG tokens
  [/([?&#](?:access_token|api_key|apikey|key|token|secret|sig|signature|password|sub_id)=)[^&\s"']+/gi, '$1***'],
];

/** Host part of a URL only — safe way to log a redirect target or LLM endpoint. */
export function hostOnly(url) {
  try { return new URL(String(url)).host || null; } catch { return null; }
}

/** Truncate free text (e.g. generated posts) — default 120 chars per canary policy. */
export function snippet(text, n = 120) {
  const s = String(text ?? '');
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

const MAX_STRING = 300;

function maskString(s) {
  let out = s;
  // A string that IS a URL: drop query/credentials entirely (affiliate links, signed URLs).
  try {
    const u = new URL(out);
    if ((u.protocol === 'http:' || u.protocol === 'https:') && (u.search || u.username || u.password)) {
      out = `${u.origin}${u.pathname}`;
    }
  } catch { /* not a URL */ }
  for (const [re, rep] of SECRET_VALUE_PATTERNS) out = out.replace(re, rep);
  if (out.length > MAX_STRING) out = `${out.slice(0, MAX_STRING)}…[${s.length} chars]`;
  return out;
}

/** Deep-sanitize any metadata object before it is serialized. */
export function sanitize(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === 'string') return maskString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) return maskString(value.message);
  if (depth >= 4) return '[depth-truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map(v => sanitize(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 40)) {
      // Booleans can't carry a secret — keep flags like api_key_set readable.
      out[k] = SECRET_KEY_RE.test(k) && typeof v !== 'boolean' ? (v == null ? v : '***') : sanitize(v, depth + 1);
    }
    return out;
  }
  return maskString(String(value));
}

export function createLogger(service) {
  const emit = (level, event, meta) => {
    const min = LEVELS[String(process.env.LOG_LEVEL ?? 'info').toLowerCase()] ?? LEVELS.info;
    if (LEVELS[level] < min) return;
    if (level === 'debug' && !debugActive()) return;   // DEBUG_UNTIL expiry turns these off live
    let line;
    try {
      line = JSON.stringify({ ts: new Date().toISOString(), service, level, event, ...sanitize(meta ?? {}) });
    } catch {
      line = JSON.stringify({ ts: new Date().toISOString(), service, level, event, meta: '[unserializable]' });
    }
    (level === 'error' ? process.stderr : process.stdout).write(line + '\n');
  };
  return {
    debug: (event, meta) => emit('debug', event, meta),
    info:  (event, meta) => emit('info', event, meta),
    warn:  (event, meta) => emit('warn', event, meta),
    error: (event, meta) => emit('error', event, meta),
    debugActive: () => debugActive(),
  };
}
