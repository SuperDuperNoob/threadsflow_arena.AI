/**
 * scripts/build_wf6.mjs
 *
 * Generate n8n/workflows/wf6_persona.json — the nightly persona post generator.
 *
 * wf6 runs at 03:30 (after wf2 finishes at 03:00) and produces the day's persona
 * (no-link, no-product, warm-up) posts from `persona_topics`. It reuses most of
 * wf2's machinery (same LLM endpoints, same persona snippet loader, same embedding
 * anti-repetition, same credential), but skips product selection, CTA comments,
 * tracked links, and image picking. Persona posts are always TEXT, sell_intensity=0,
 * and use the persona-specific writer prompt and QA gate.
 *
 * Run with:  node scripts/build_wf6.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const WORKFLOWS_DIR = './n8n/workflows';
const CODE_DIR = './n8n/code';
const PROMPTS_DIR = './prompts';

function read(p) { return fs.readFileSync(p, 'utf8'); }
function code(filename) {
  return read(path.join(CODE_DIR, filename));
}
function prompt(filename) {
  return read(path.join(PROMPTS_DIR, filename));
}

// Stable node ids (used for connections).
const IDS = {
  cron: 'cron6',
  load: 'load6',
  slots: 'slots6',
  topic: 'topic6',
  persona: 'persona6',
  build: 'build6',
  write: 'write6',
  edit: 'edit6',
  embed: 'embed6',
  qa: 'qa6',
  qaif: 'qaif6',
  queue: 'queue6',
  logqa: 'logqa6',
  logllm: 'logllm6',
  updateTopic: 'utopic6',
};

const PG_CRED = { postgres: { id: 'PG', name: 'Postgres threadsflow' } };

function node(id, name, type, typeVersion, position, parameters, extra = {}) {
  return { id, name, type, typeVersion, position, parameters, ...extra };
}

// ── Load config + persona topics query (one row, analogous to wf2's "Load config + state").
const LOAD_QUERY = `WITH llm_defaults AS (
  SELECT '{
    "base_url": "https://9router.archxry.space/v1",
    "api_key": "",
    "model_write": "gemini-2.5-flash",
    "model_edit": "gpt-4.1-mini",
    "model_embed": "text-embedding-3-small",
    "model_mine": "gemini-2.5-pro"
  }'::jsonb AS value
), warmup_defaults AS (
  SELECT '{
    "persona_slot_hours": [7,11,16,21],
    "persona_jitter_min": 22,
    "persona_skip_prob": 0.08,
    "persona_micro_pct": 0.25,
    "persona_mid_pct": 0.60,
    "persona_long_pct": 0.15,
    "timezone": "Asia/Kuala_Lumpur"
  }'::jsonb AS value
), loaded AS (
  SELECT
    (SELECT value FROM llm_defaults) || COALESCE((SELECT value FROM settings WHERE key='llm'), '{}'::jsonb) AS llm,
    COALESCE((SELECT value FROM settings WHERE key='qa'), '{}'::jsonb) AS qa,
    COALESCE((SELECT value FROM settings WHERE key='warmup'), (SELECT value FROM warmup_defaults)) AS warmup,
    COALESCE((SELECT value FROM settings WHERE key='bandit'), '{}'::jsonb) AS bandit,
    COALESCE((SELECT jsonb_agg(to_jsonb(b)) FROM banned_phrases b
              WHERE b.scope IN ('all','persona_opener','persona_all')), '[]'::jsonb) AS banned,
    COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM (
       SELECT body, embedding FROM posts
        WHERE status IN ('published','queued')
        ORDER BY created_at DESC LIMIT 30
     ) r), '[]'::jsonb) AS recent,
    COALESCE((SELECT jsonb_agg(to_jsonb(ps)) FROM (
       SELECT id, domain, title, register, tags, text
         FROM v_persona_snippets_for_prompt
        LIMIT 24
     ) ps), '[]'::jsonb) AS persona_snippets,
    COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM (
       SELECT id, uid, topic, angle_hint, niche_tags, n, alpha, beta, cooldown_until,
              context, pinned
         FROM persona_topics
        WHERE cooldown_until IS NULL OR cooldown_until < now()
        ORDER BY pinned DESC, (alpha/(alpha+beta)) DESC, random()
        LIMIT 50
     ) t), '[]'::jsonb) AS topics
)
SELECT llm, qa, warmup, bandit, banned, recent, persona_snippets, topics,
  jsonb_build_object('llm', llm, 'qa', qa, 'warmup', warmup, 'bandit', bandit) AS settings,
  jsonb_build_object(
    'llm', llm, 'qa', qa, 'warmup', warmup, 'bandit', bandit,
    'banned', banned, 'recent', recent,
    'persona_snippets', persona_snippets, 'topics', topics
  ) AS cfg
FROM loaded;`;

// The writer prompt template is loaded from prompts/persona_writer.md and embedded
// at build time, so n8n has everything it needs without file reads at runtime.
const WRITER_SYSTEM = prompt('persona_writer.md')
  .split('---')[0]
  .replace(/^#.*\n/gm, '')
  .replace(/Send as `system` \+ `user`[^]*?---/s, '')
  .trim();

const WRITER_SYSTEM_FULL = prompt('persona_writer.md').split('---')[0]
  .replace(/^#.*\n/gm, '').trim();
// Cleaner: use content between first ## SYSTEM and the next ## USER section.
const SYS_MATCH = prompt('persona_writer.md').match(/## SYSTEM\n([\s\S]*?)\n---\n\n## USER/);
const USER_MATCH = prompt('persona_writer.md').match(/## USER\n([\s\S]*)$/);
const WRITER_SYS = (SYS_MATCH ? SYS_MATCH[1] : '').trim();
const WRITER_USER_TMPL = (USER_MATCH ? USER_MATCH[1] : '').trim();

// Editor / human-pass prompt: light touch-up, same language, remove any residual sell language.
const EDITOR_SYS = `You are an editor for a Malaysian person's personal Threads account. You receive a drafted persona post (NO links, NO selling). Your job:
1. Keep the same meaning, voice, rhythm, and first-person point of view.
2. Trim any phrase that sounds like marketing, a template, or an AI ("inilah", "marilah", "wajib tau", "korang mesti").
3. Fix any Indonesian slip-ups (banget/nggak/gak/bisa/butuh/aja/udah) to Malay (sangat/tak/boleh/perlu/saja/sudah).
4. Keep it under 500 chars and in one paragraph unless the original uses line breaks intentionally.
5. Output ONLY the cleaned post. No quotes, no preamble, no explanation.`;

const buildEditorUser = `Here is a drafted Threads post. Return a cleaned-up version that sounds like a real person typed it on their phone. Keep the same opening idea.

Draft:
{{draft}}`;

const buildWriterUser = (topic, lever, personaFragment, recentOpeners) => {
  // Fill the persona_writer.md {{placeholders}} with simple value substitution.
  let t = WRITER_USER_TMPL;
  const angleHint = topic.angle_hint
    ? `Suggested angle: ${topic.angle_hint} (don't name the angle in the post).`
    : '';
  const timelyNote = topic.context?.timely_note
    ? `Timely context from the last 7 days (use ONLY as flavour — never state facts you can't verify, never cite a source, never say "menurut" or "baru-baru ini orang cakap"):\n${topic.context.timely_note}`
    : '';
  const angles = (topic.context?.angles?.length
    ? `Possible angles to explore (pick ONE, don't list them):\n${topic.context.angles.map(a => `- ${a}`).join('\n')}`
    : '');
  const persona = personaFragment || '(no persona snippets loaded)';
  const openers = recentOpeners && recentOpeners.length
    ? recentOpeners.map(o => `- ${o}`).join('\n')
    : '(none yet)';
  const recent = recentOpeners && recentOpeners.length
    ? recentOpeners.map(o => `- ${o}`).join('\n')
    : '(no prior posts yet)';

  return t
    .replace(/\{\{topic\.topic\}\}/g, topic.topic.replace(/</g,'&lt;'))
    .replace(/\{\{#if topic\.angle_hint\}\}[\s\S]*?\{\{\/if\}\}/g, angleHint ? angleHint : '')
    .replace(/\{\{topic\.angle_hint\}\}/g, topic.angle_hint || '')
    .replace(/\{\{#if topic\.context\.timely_note\}\}[\s\S]*?\{\{\/if\}\}/g, timelyNote ? timelyNote : '')
    .replace(/\{\{#if topic\.context\.angles\}\}[\s\S]*?\{\{\/each\}\}[\s\S]*?\{\{\/if\}\}/g, angles)
    .replace(/\{\{lever\.tone\.label\}\}/g, lever.tone_label)
    .replace(/\{\{lever\.tone\.brief\}\}/g, lever.tone_brief)
    .replace(/\{\{lever\.format\.label\}\}/g, lever.format_label)
    .replace(/\{\{lever\.format\.brief\}\}/g, lever.format_brief)
    .replace(/\{\{lever\.length_band\.label\}\}/g, lever.length_band_label)
    .replace(/\{\{lever\.length_band\.brief\}\}/g, lever.length_band_brief)
    .replace(/\{\{recent_openers\}\}/g, openers)
    .replace(/\{\{#each recent_posts\}\}[\s\S]*?\{\{\/each\}\}/g, recent)
    .replace(/\{\{#if persona_fragment\}\}[\s\S]*?\{\{else\}\}[\s\S]*?\{\{\/if\}\}/g,
      personaFragment ? personaFragment : '(no persona calibration loaded).')
    .replace(/\{\{persona_fragment\}\}/g, personaFragment || '');
};

// The "Build prompts" Code node is what we add here because n8n's templating
// can't do the complex conditional sections in Handlebars. We compute system/user
// strings in JS and attach them to $json for the HTTP nodes to read.
const BUILD_PROMPT_CODE = `// Build writer + editor prompt strings from the loaded topic/lever.
// Output sets writer_system, writer_user, editor_system, editor_user, post_uid for the INSERT.
const d = $json;
const topic = d.topic || {};
const snippets = d.persona_snippets || d.cfg?.persona_snippets || [];
const recent = d.recent || d.cfg?.recent || [];
const llm = d.cfg?.llm || d.llm || {};

// Pick 0-3 random persona snippets (none ~25% of the time, for voice variety).
let persona_fragment = '';
if (snippets.length && Math.random() > 0.25) {
  const shuffled = [...snippets].sort(() => Math.random() - 0.5).slice(0, 2);
  persona_fragment =
    '### Persona calibration — real Malaysian cadence references\\n' +
    'Borrow RHYTHM, SENTENCE PRESSURE, and REGISTER only. Do not copy wording, facts, or topic.\\n' +
    shuffled.map((s,i)=>'('+(s.register||'neutral')+' · '+(s.domain||'')+') '+String(s.text||'').slice(0,420)).join('\\n');
}

// Format lever labels so prompts have human-readable names — the bandit sets codes.
const LEVER_LABELS = {
  format: {
    flash_story:['Cerita kilat','Mikro-cerita 3 babak'],
    confession:['Pengakuan','Nada pengakuan peribadi'],
    pov:['POV','Satu saat dari sudut orang kedua'],
    chat_narration:['Cerita balik perbualan','Petikan perbualan pendek'],
    list_of_three:['Tiga pemerhatian','Tiga perkara kecil, baris berasingan'],
    one_liner:['Satu baris','Maksimum dua ayat pendek'],
    honest_review:['Pemerhatian jujur','Satu kelemahan / kelebihan yang spesifik'],
    diary:['Diari','Catatan hari dengan butiran deria kecil'],
    myth_bust:['Pecahkan tanggapan','Patahkan andaian umum dengan pengalaman sendiri'],
    overheard:['Terdengar','Cerita sesuatu yang kedengaran di tempat awam'],
    before_after:['Sebelum-selepas','Dua perenggan berlawanan tanpa kata "sebelum"/"selepas"'],
    question_hook:['Soalan umpan','Soalan sangat spesifik, jawab separuh'],
  },
  tone: {
    deadpan:['Datar','Tiada emoji, tiada seru, humor kering'],
    gaul:['Santai','Bahasa Melayu pasar harian: tak, nak, dah, je, kot, lah'],
    warm_sibling:['Macam abang/kakak','Mesra, menenangkan, jangan berlagak pandai'],
    corporate_parody:['Parodi korporat','Bahasa pejabat secara melampau untuk lawak'],
    chaotic:['Bersepah','Ayat terputus-putus, satu idea utama'],
    minimal:['Minimalis','Ayat pendek, ruang kosong, tiada emoji'],
    enthusiast:['Teruja','Teruja tapi ada sebab konkrit'],
  },
  length_band: {
    micro:['Mikro','Maksimum 120 aksara'],
    mid:['Sederhana','120–260 aksara'],
    long:['Panjang','260–480 aksara, 2-3 perenggan pendek'],
  },
};
const get = (kind, code) => {
  const m = LEVER_LABELS[kind]?.[code] || [code, ''];
  return { label: m[0], brief: m[1] };
};
const lever = {
  tone_label: get('tone', d.tone).label,
  tone_brief: get('tone', d.tone).brief,
  format_label: get('format', d.format).label,
  format_brief: get('format', d.format).brief,
  length_band_label: get('length_band', d.length_band).label,
  length_band_brief: get('length_band', d.length_band).brief,
};

// Writer prompt (mirrors prompts/persona_writer.md, filled for this slot).
const writer_system = ${JSON.stringify(WRITER_SYS)};

let angleHint = topic.angle_hint
  ? 'Suggested angle: ' + topic.angle_hint + ' (do not name the angle in the post).'
  : '';
let timelyNote = topic.context?.timely_note
  ? ('Timely context (flavour only; never state "menurut" / cite a source / treat as fact):\\n' + topic.context.timely_note)
  : '';
let anglesList = Array.isArray(topic.context?.angles) && topic.context.angles.length
  ? ('Possible angles (pick ONE, do not list):\\n' + topic.context.angles.map(a=>'- '+a).join('\\n'))
  : '';

const openerList = (recent && recent.length)
  ? recent.slice(0,20).map(r=>'- '+String(r.body||'').split(/\\s+/).slice(0,5).join(' ')).join('\\n')
  : '(none yet)';

const writer_user =
  '### Topic for today\\n' +
  '**' + (topic.topic||'') + '**\\n' +
  angleHint + (angleHint?'\\n':'') +
  timelyNote + (timelyNote?'\\n\\n':'') +
  anglesList + (anglesList?'\\n\\n':'') +
  '\\n### Assignment\\n' +
  '- Tone: **' + lever.tone_label + '** — ' + lever.tone_brief + '\\n' +
  '- Format: **' + lever.format_label + '** — ' + lever.format_brief + '\\n' +
  '- Length: **' + lever.length_band_label + '** — ' + lever.length_band_brief + '\\n' +
  '- Media: **TEXT only** (no image). The words must carry everything.\\n' +
  '\\n### Openings already used recently — do NOT repeat any of these\\n' +
  openerList + '\\n\\n' +
  persona_fragment + '\\n\\n' +
  '### One more thing\\n' +
  'Ground this in a single tiny moment. One time. One place. One sensation.\\n' +
  'Write the post now.';

const editor_system = ${JSON.stringify(EDITOR_SYS)};
const editor_user_prefix = 'Here is a drafted Threads persona post. Clean it up so a real Malaysian person would have typed it. Keep the same opening idea.\\n\\nDraft:\\n';

// Stable short uid for the post (used as redirect slug placeholder; persona posts have no CTA but we still need a uid).
function shortUid() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i=0;i<6;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return 'p' + s;
}

return [{ json: {
  ...d,
  writer_system, writer_user,
  editor_system, editor_user_prefix,
  topic,
  post_uid: 'p' + shortUid().slice(1),
} }];`;

const QUEUE_POST_QUERY = `WITH new_post AS (
  INSERT INTO posts (uid, product_id, image_ids, media_type, format, angle, tone, sell_intensity,
    length_band, is_carousel, body, cta_text, tracked_url, embedding, char_count,
    emoji_count, hashtag_used, status, scheduled_at, reply_delay_sec, purpose, persona_topic_id, topic_context, generation)
  VALUES ($1,NULL,'{}','TEXT',$2,'utility',$3,'0',$4,false,$5,NULL,NULL,$6,$7,$8,$9,'queued',$10,0,'persona',$11,$12::jsonb,0)
  RETURNING id
), ckpt AS (
  INSERT INTO run_log (workflow, level, message, meta)
  VALUES ('wf6_persona','info','persona post queued',
          jsonb_build_object('uid',$1,'status','queued','media_type','TEXT',
                             'char_count',$7,'scheduled_at',$10,'topic_id',$11,'qa','pass'))
  RETURNING 1
)
SELECT id FROM new_post;`;

const LOG_QA_QUERY = `INSERT INTO run_log (workflow, level, message, meta)
VALUES ('wf6_persona','warn','QA rejected a persona draft', $1::jsonb);`;

const LOG_LLM_QUERY = `INSERT INTO run_log (workflow, level, message, meta)
VALUES ('wf6_persona','error','LLM call failed', $1::jsonb);`;

const UPDATE_TOPIC_USED_QUERY = `UPDATE persona_topics
  SET times_picked = COALESCE(times_picked,0) + 1,
      last_context_at = now()
WHERE id = $1::bigint;`;

function postgresNode(id, name, position, query, replacement, extra = {}) {
  return node(id, name, 'n8n-nodes-base.postgres', 2.5, position, {
    operation: 'executeQuery',
    query,
    options: replacement ? { queryReplacement: replacement } : {},
  }, { credentials: PG_CRED, ...extra });
}

function httpNode(id, name, position, urlExpr, bodyExpr, authExpr) {
  return node(id, name, 'n8n-nodes-base.httpRequest', 4.2, position, {
    method: 'POST',
    url: urlExpr,
    sendHeaders: true,
    headerParameters: {
      parameters: authExpr ? [{ name: 'authorization', value: authExpr }] : [],
    },
    sendBody: true,
    specifyBody: 'json',
    jsonBody: bodyExpr,
    options: { response: { response: { neverError: true } } },
  }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 8000, continueOnFail: false });
}

function codeNode(id, name, position, jsCode) {
  return node(id, name, 'n8n-nodes-base.code', 2, position, { jsCode });
}

function cronNode() {
  return node(IDS.cron, 'Daily 03:30 (persona)', 'n8n-nodes-base.scheduleTrigger', 1.2, [-680, 300], {
    rule: { interval: [{ field: 'cronExpression', expression: '30 3 * * *' }] },
  }, { notes: 'Runs after wf2_generate (03:00) so persona slots land after product slots.' });
}

const nodes = [
  cronNode(),

  postgresNode(IDS.load, 'Load config + topics', [-460, 300], LOAD_QUERY, null, {
    notes: 'Loads llm config, QA rules, warm-up slot settings, recent posts (for anti-repetition), persona snippets, and candidate persona_topics (Thompson-ranked).',
  }),

  codeNode(IDS.slots, 'Build persona slots', [-240, 300], code('persona_slot_plan.js')),

  codeNode(IDS.topic, 'Pick persona topic', [-20, 300], code('persona_topic_pick.js')),

  codeNode(IDS.persona, 'Persona: Malay cadence', [200, 300], code('persona_picker.js')),

  codeNode(IDS.build, 'Build prompts', [400, 300], BUILD_PROMPT_CODE),

  httpNode(IDS.write, 'LLM: write persona', [640, 300],
    "={{ String($json.cfg.llm.base_url || '').replace(/\\/+$/, '') }}/chat/completions",
    "={{ JSON.stringify({ model: $json.cfg.llm.model_write, temperature: 0.95, top_p: 0.98, messages: [{ role:'system', content: $json.writer_system }, { role:'user', content: $json.writer_user }] }) }}",
    "={{ $json.cfg.llm.api_key ? 'Bearer ' + $json.cfg.llm.api_key : '' }}"),

  httpNode(IDS.edit, 'LLM: human pass', [880, 300],
    "={{ String($('Build prompts').item.json.cfg.llm.base_url || '').replace(/\\/+$/, '') }}/chat/completions",
    "={{ JSON.stringify({ model: $('Build prompts').item.json.cfg.llm.model_edit, temperature: 0.7, messages: [{ role:'system', content: $('Build prompts').item.json.editor_system }, { role:'user', content: $('Build prompts').item.json.editor_user_prefix + $json.choices[0].message.content }] }) }}",
    "={{ $('Build prompts').item.json.cfg.llm.api_key ? 'Bearer ' + $('Build prompts').item.json.cfg.llm.api_key : '' }}"),

  httpNode(IDS.embed, 'LLM: embed', [1120, 300],
    "={{ String($('Build prompts').item.json.cfg.llm.base_url || '').replace(/\\/+$/, '') }}/embeddings",
    "={{ JSON.stringify({ model: $('Build prompts').item.json.cfg.llm.model_embed, input: $json.choices[0].message.content }) }}",
    "={{ $('Build prompts').item.json.cfg.llm.api_key ? 'Bearer ' + $('Build prompts').item.json.cfg.llm.api_key : '' }}"),

  codeNode(IDS.qa, 'Persona QA gate', [1340, 300], code('qa_persona.js')),

  node(IDS.qaif, 'Passed QA?', 'n8n-nodes-base.if', 2.2, [1560, 300], {
    conditions: {
      options: { version: 2 },
      conditions: [{
        leftValue: '={{ $json.pass }}',
        rightValue: true,
        operator: { type: 'boolean', operation: 'true', singleValue: true },
      }],
      combinator: 'and',
    },
    options: {},
  }),

  postgresNode(IDS.queue, 'Queue persona post', [1780, 240], QUEUE_POST_QUERY,
    "={{ $json.post_uid }},={{ $json.format }},={{ $json.tone }},={{ $json.length_band }},={{ $json.cleaned }},={{ $json.embedding }},={{ $json.stats.chars }},={{ $json.stats.emoji }},={{ $json.stats.hashtag }},={{ $json.scheduled_at }},={{ $json.topic.id || null }},={{ JSON.stringify({angle_hint:$json.topic.angle_hint,niche_tags:$json.topic.niche_tags,context_bucket:$json.context_bucket}) }}",
    { notes: 'INSERT with purpose=persona. No product_id, no CTA, no tracked_url.' }),

  postgresNode(IDS.updateTopic, 'Bump topic use count', [2000, 240], UPDATE_TOPIC_USED_QUERY,
    "={{ $json.topic.id || null }}",
    { notes: 'Increments times_picked so the bandit rotates topics.' }),

  postgresNode(IDS.logqa, 'Log QA rejection', [1780, 420], LOG_QA_QUERY,
    "={{ JSON.stringify({reasons: $json.reasons, slot: $json.slot_index, topic: $json.topic && $json.topic.topic}) }}"),

  postgresNode(IDS.logllm, 'Log LLM failure', [640, 480], LOG_LLM_QUERY,
    "={{ JSON.stringify({node: $prevNode.name, error: String(($json.error && ($json.error.message || $json.error.description)) || $json.message || 'unknown').slice(0, 300)}) }}"),
];

// Connections: straightforward linear chain with error branches on HTTP/QA.
const connections = {
  'Daily 03:30 (persona)': { main: [[{ node: 'Load config + topics', type: 'main', index: 0 }]] },
  'Load config + topics': { main: [[{ node: 'Build persona slots', type: 'main', index: 0 }]] },
  'Build persona slots': { main: [[{ node: 'Pick persona topic', type: 'main', index: 0 }]] },
  'Pick persona topic': { main: [[{ node: 'Persona: Malay cadence', type: 'main', index: 0 }]] },
  'Persona: Malay cadence': { main: [[{ node: 'Build prompts', type: 'main', index: 0 }]] },
  'Build prompts': { main: [[{ node: 'LLM: write persona', type: 'main', index: 0 }]] },
  'LLM: write persona': {
    main: [
      [{ node: 'LLM: human pass', type: 'main', index: 0 }],
      [{ node: 'Log LLM failure', type: 'main', index: 0 }],
    ],
  },
  'LLM: human pass': {
    main: [
      [{ node: 'LLM: embed', type: 'main', index: 0 }],
      [{ node: 'Log LLM failure', type: 'main', index: 0 }],
    ],
  },
  'LLM: embed': {
    main: [
      [{ node: 'Persona QA gate', type: 'main', index: 0 }],
      [{ node: 'Log LLM failure', type: 'main', index: 0 }],
    ],
  },
  'Persona QA gate': { main: [[{ node: 'Passed QA?', type: 'main', index: 0 }]] },
  'Passed QA?': {
    main: [
      [{ node: 'Queue persona post', type: 'main', index: 0 }],
      [{ node: 'Log QA rejection', type: 'main', index: 0 }],
    ],
  },
  'Queue persona post': { main: [[{ node: 'Bump topic use count', type: 'main', index: 0 }]] },
};

const workflow = {
  name: 'wf6_persona',
  nodes,
  connections,
  settings: {
    executionOrder: 'v1',
    timezone: 'Asia/Kuala_Lumpur',
    errorWorkflow: '',
    saveManualExecutions: true,
    saveDataErrorExecution: 'all',
    saveDataSuccessExecution: 'none',
  },
  tags: [{ name: 'threadsflow' }],
  staticData: null,
  pinData: {},
  versionId: '1',
};

// Validate JSON.
const out = JSON.stringify(workflow, null, 2) + '\n';
JSON.parse(out);

const outPath = path.join(WORKFLOWS_DIR, 'wf6_persona.json');
fs.writeFileSync(outPath, out, 'utf8');
console.log('Wrote', outPath, '(', out.length, 'bytes )');
