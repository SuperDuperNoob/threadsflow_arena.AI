/**
 * LLM + embedding client. OpenAI-compatible, so it points at 9router.
 * Includes retry with backoff and a hard concurrency cap — a 300-page book is ~40 mining
 * calls and you do not want 40 in flight on a 2 vCPU box.
 */

const {
  LLM_BASE_URL = 'http://host.docker.internal:9000/v1',
  LLM_API_KEY = '',
  LLM_MODEL_MINE = 'gemini-2.5-pro',
  LLM_MODEL_EMBED = 'text-embedding-3-small',
} = process.env;

async function post(path, body, { tries = 4 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${LLM_BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${LLM_API_KEY}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}: ${await res.text()}`), { fatal: true });
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (e.fatal) throw e;
      await new Promise(r => setTimeout(r, 1500 * 2 ** i + Math.random() * 800));
    }
  }
  throw lastErr;
}

export async function complete(system, user, { json = true, temperature = 0.3, model } = {}) {
  const body = {
    model: model ?? LLM_MODEL_MINE,
    temperature,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  };
  if (json) body.response_format = { type: 'json_object' };
  const out = await post('/chat/completions', body);
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
  const input = Array.isArray(texts) ? texts : [texts];
  const out = [];
  // batch of 64 keeps request bodies small
  for (let i = 0; i < input.length; i += 64) {
    const res = await post('/embeddings', {
      model: LLM_MODEL_EMBED,
      input: input.slice(i, i + 64).map(t => t.slice(0, 8000)),
    });
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
