/**
 * LLM + embedding client. OpenAI-compatible by design.
 *
 * Defaults point at hosted 9router, but the effective config can be changed from:
 *   1. the `settings.llm` JSON row in Postgres (preferred; editable from KB Settings), or
 *   2. environment variables (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL_*), or
 *   3. the hard-coded hosted-9router fallback below.
 *
 * Includes retry with backoff and a hard concurrency cap — a 300-page book is ~40 mining
 * calls and you do not want 40 in flight on a 2 vCPU box.
 */

import { createLogger, hostOnly } from './logger.js';

const log = createLogger('kb');

const HOSTED_9ROUTER_BASE_URL = 'https://9router.archxry.space/v1';

function cleanBaseUrl(value) {
  const s = String(value ?? '').trim().replace(/\/+$/, '');
  if (!s) return HOSTED_9ROUTER_BASE_URL;
  try {
    const u = new URL(s);
    if (!['http:', 'https:'].includes(u.protocol)) return HOSTED_9ROUTER_BASE_URL;
    return u.toString().replace(/\/+$/, '');
  } catch {
    return HOSTED_9ROUTER_BASE_URL;
  }
}

export function normalizeLlmConfig(raw = {}) {
  const env = process.env;
  const first = (...values) => values.find(v => String(v ?? '').trim() !== '');
  const cfg = {
    base_url: cleanBaseUrl(first(raw.base_url, raw.url, env.LLM_BASE_URL, HOSTED_9ROUTER_BASE_URL)),
    api_key: String(first(raw.api_key, raw.key, env.LLM_API_KEY, '')).trim(),
    model_write: String(first(raw.model_write, env.LLM_MODEL_WRITE, 'gemini-2.5-flash')).trim(),
    model_edit: String(first(raw.model_edit, env.LLM_MODEL_EDIT, 'gpt-4.1-mini')).trim(),
    model_embed: String(first(raw.model_embed, env.LLM_MODEL_EMBED, 'text-embedding-3-small')).trim(),
    model_mine: String(first(raw.model_mine, raw.model, env.LLM_MODEL_MINE, env.LLM_MODEL, 'gemini-2.5-pro')).trim(),
  };

  // Keep every model field non-empty so a half-filled settings row does not break calls.
  if (!cfg.model_write) cfg.model_write = 'gemini-2.5-flash';
  if (!cfg.model_edit) cfg.model_edit = 'gpt-4.1-mini';
  if (!cfg.model_embed) cfg.model_embed = 'text-embedding-3-small';
  if (!cfg.model_mine) cfg.model_mine = 'gemini-2.5-pro';
  return cfg;
}

let settingsPool = null;
let cachedConfig = null;
let cachedAt = 0;

/** Register a pg.Pool so the KB worker can share the same LLM config as n8n. */
export function registerLlmPool(pool) {
  settingsPool = pool;
  cachedConfig = null;
  cachedAt = 0;
}

export function clearLlmConfigCache() {
  cachedConfig = null;
  cachedAt = 0;
}

let lastLoggedConfigSig = '';

export async function getLlmConfig() {
  // Short cache keeps PDF mining fast while still letting the Settings page take effect quickly.
  if (cachedConfig && Date.now() - cachedAt < 5_000) return cachedConfig;

  let rowConfig = {};
  let source = 'env/default';
  if (settingsPool) {
    try {
      const { rows } = await settingsPool.query("SELECT value FROM settings WHERE key='llm'");
      rowConfig = rows[0]?.value ?? {};
      if (rows.length) source = 'settings.llm';
    } catch {
      // Database not initialised yet; fall back to env/defaults. Startup should not crash.
      rowConfig = {};
    }
  }

  cachedConfig = normalizeLlmConfig(rowConfig);
  cachedAt = Date.now();

  // Log the effective config once per change — host + model names only, never the key.
  const sig = [source, cachedConfig.base_url, cachedConfig.model_write, cachedConfig.model_edit,
               cachedConfig.model_embed, cachedConfig.model_mine, Boolean(cachedConfig.api_key)].join('|');
  if (sig !== lastLoggedConfigSig) {
    lastLoggedConfigSig = sig;
    log.info('llm_config_loaded', {
      source,
      base_url_host: hostOnly(cachedConfig.base_url),
      model_write: cachedConfig.model_write,
      model_edit: cachedConfig.model_edit,
      model_embed: cachedConfig.model_embed,
      model_mine: cachedConfig.model_mine,
      api_key_set: Boolean(cachedConfig.api_key),
    });
  }
  return cachedConfig;
}

function authHeaders(apiKey) {
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

async function post(path, body, { tries = 4, config } = {}) {
  let lastErr;
  const cfg = config ? normalizeLlmConfig(config) : await getLlmConfig();
  const url = `${cfg.base_url}${path.startsWith('/') ? path : `/${path}`}`;
  const endpoint = path.startsWith('/') ? path : `/${path}`;
  // Never log the full URL (query strings/keys); host + path + model is enough to debug.
  const callMeta = { endpoint, host: hostOnly(url), model: body?.model ?? null };

  for (let i = 0; i < tries; i++) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders(cfg.api_key) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}: ${await res.text()}`), { fatal: true });
      log.debug('llm_call_ok', { ...callMeta, status: res.status, latency_ms: Date.now() - t0, attempt: i + 1 });
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (e.fatal) {
        log.error('llm_call_fatal', { ...callMeta, latency_ms: Date.now() - t0, attempt: i + 1, reason: e.message });
        throw e;
      }
      log.warn('llm_call_retry', {
        ...callMeta, latency_ms: Date.now() - t0,
        attempt: i + 1, max_attempts: tries, reason: e.message,
      });
      await new Promise(r => setTimeout(r, 1500 * 2 ** i + Math.random() * 800));
    }
  }
  log.error('llm_call_failed', { ...callMeta, attempts: tries, reason: lastErr?.message ?? 'unknown' });
  throw lastErr;
}

export async function complete(system, user, { json = true, temperature = 0.3, model } = {}) {
  const cfg = await getLlmConfig();
  const body = {
    model: model ?? cfg.model_mine,
    temperature,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  };
  if (json) body.response_format = { type: 'json_object' };
  const out = await post('/chat/completions', body, { config: cfg });
  const txt = out.choices?.[0]?.message?.content?.trim() ?? '';
  if (!json) return txt;
  try {
    return JSON.parse(txt.replace(/^```(?:json)?\n?|```$/g, ''));
  } catch {
    // models occasionally wrap or trail; salvage the outermost object
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('LLM returned non-JSON');
  }
}

export async function embed(texts) {
  const cfg = await getLlmConfig();
  const input = Array.isArray(texts) ? texts : [texts];
  const out = [];
  // batch of 64 keeps request bodies small
  for (let i = 0; i < input.length; i += 64) {
    const res = await post('/embeddings', {
      model: cfg.model_embed,
      input: input.slice(i, i + 64).map(t => t.slice(0, 8000)),
    }, { config: cfg });
    out.push(...res.data.map(d => d.embedding));
  }
  return Array.isArray(texts) ? out : out[0];
}

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** Run tasks with bounded concurrency. 2 vCPU → keep this at 2-3. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }));
  return out;
}
