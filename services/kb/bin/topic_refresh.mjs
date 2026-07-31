#!/usr/bin/env node
/**
 * bin/topic_refresh.mjs
 *
 * Call Perplexity Sonar to fetch timely topics for persona posts and insert them
 * into `persona_topics`. Run weekly (by cron inside wf7_topic_refresh or via docker cron).
 *
 * Usage:
 *   node bin/topic_refresh.mjs            # refresh (dry-run if DRY_RUN=1)
 *   DRY_RUN=1 node bin/topic_refresh.mjs   # show what would be inserted without writing
 *
 * Env:
 *   DATABASE_URL, PERPLEXITY_API_KEY, PERPLEXITY_MODEL (defaults: sonar)
 */
import pg from 'pg';
import { completePerplexity } from '../lib/llm.js';

const { Pool } = pg;

const DRY_RUN = process.env.DRY_RUN === '1';
const MAX_TOPICS = Number(process.env.TOPIC_REFRESH_COUNT ?? 8);
const MIN_PERPLEXITY_TOPIC_LEN = 15;
const MAX_PERPLEXITY_TOPIC_LEN = 120;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

  try {
    // Fetch existing topics so we can dedupe against what's already there.
    const { rows: existing } = await pool.query(
      `SELECT topic FROM persona_topics WHERE created_at > now() - interval '28 days'`
    );
    const existingTopics = new Set(existing.map(r => r.topic.toLowerCase().trim()));

    // Source id for perplexity-derived topics.
    const { rows: srcRows } = await pool.query(
      `SELECT id FROM persona_topic_sources WHERE slug='perplexity_weekly'`
    );
    const sourceId = srcRows[0]?.id ?? null;

    const SYSTEM = `You curate micro-topics for a PERSONAL Threads account belonging to a regular
Malaysian person posting in Bahasa Melayu harian (casual, rojak, real). The account is in
warm-up — it is NOT yet posting product links; it is posting small observations, petua,
soalan, and luahan about everyday Malaysian life to build a real-person signal.

Return a JSON object of the form:
{
  "topics": [
    { "topic": "...", "angle_hint": "petua|luahan|soalan|petua|observation|rant", "niche_tags": ["...","..."] },
    ...
  ]
}

Rules for each topic (MUST obey all):
1. Topic string must be in the FIRST PERSON or describe a small specific moment a normal
   Malaysian might post about (dapur, mamak, office, WFH, hujan, parking, Grab, family WAGroup,
   dobi, peti ais, sayur, teh tarik, Waze, tidur, panas, bil elektrik, etc).
2. 15–120 characters.
3. Written in the register someone would actually TYPE INTO THREADS (casual BM, rojak OK).
4. Angle hint is one of: petua, luahan, soalan, observation, rant.
5. 1-3 niche tags (Malaysian household/dapur/commute/work/food/cuaca/family/money/everyday).
6. NO promo, NO products, NO Shopee/Lazada links.
7. NO generic vague "Hidup ini..." philosophy. Must have a specific anchor.
8. AVOID these overdone shapes: "Korang pernah tak X?", "Siapa kat sini yang X?",
   "Jom...", generic "relatable" platitudes.
9. Topics must feel TIMELY to the last 7 days (rainy season, current cost of living,
   Ramadhan/hari raya if relevant, Monday blues, Friday evenings, etc) but NOT reference
   specific politicians or sensitive issues.
10. Return exactly ${MAX_TOPICS} topics.`;

    const USER = `Generate ${MAX_TOPICS} fresh, specific, small Malaysian-life topics I could post
about on Threads this week. No product mentions. No selling. Just specific everyday moments
that invite a reply. Avoid these already-suggested topics (do not duplicate or near-duplicate):
${[...existingTopics].slice(0, 40).map(t => `- ${t}`).join('\n')}

Return only the JSON. No preamble.`;

    console.log('Calling Perplexity Sonar...');
    const result = await completePerplexity(SYSTEM, USER, {
      temperature: 0.8,
      max_tokens: 1500,
      model: process.env.PERPLEXITY_MODEL ?? 'sonar',
      search_recency_filter: 'week',
    });
    console.log(`Perplexity returned ${result.content.length} chars; citations: ${(result.citations || []).length}`);

    let parsed;
    try {
      parsed = JSON.parse(result.content.replace(/^```(?:json)?\n?|```$/g, '').trim());
    } catch (e) {
      const m = result.content.match(/\{[\s\S]*\}/);
      if (!m) {
        console.error('Could not parse JSON from Perplexity response');
        console.error(result.content.slice(0, 1200));
        process.exit(2);
      }
      parsed = JSON.parse(m[0]);
    }
    const topics = Array.isArray(parsed?.topics) ? parsed.topics : [];
    if (!topics.length) {
      console.error('Perplexity returned zero topics');
      process.exit(3);
    }

    // Validate and dedupe each topic.
    const insertable = [];
    for (const t of topics) {
      const topic = String(t.topic ?? '').trim();
      if (topic.length < MIN_PERPLEXITY_TOPIC_LEN || topic.length > MAX_PERPLEXITY_TOPIC_LEN) continue;
      if (existingTopics.has(topic.toLowerCase())) continue;
      if (/[?!]+$/.test(topic) && !/^.{15,}$/.test(topic)) continue;
      const angle = ['petua', 'luahan', 'soalan', 'observation', 'rant'].includes(t.angle_hint)
        ? t.angle_hint : 'observation';
      const tags = Array.isArray(t.niche_tags)
        ? t.niche_tags.map(x => String(x).toLowerCase().trim()).filter(x => x).slice(0, 3)
        : [];
      insertable.push({ topic, angle, tags });
      existingTopics.add(topic.toLowerCase());
    }

    console.log(`Parsed ${topics.length} topics; ${insertable.length} are new and valid.`);
    for (const t of insertable) console.log(`  [${t.angle}] ${t.topic}  (${t.tags.join(',')})`);

    if (DRY_RUN) {
      console.log('DRY_RUN=1 — not inserting.');
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const t of insertable) {
        await client.query(
          `INSERT INTO persona_topics (source_id, topic, angle_hint, niche_tags, context)
           VALUES ($1,$2,$3,$4::text[], $5::jsonb)
           ON CONFLICT (source_id, topic) DO NOTHING`,
          [sourceId, t.topic, t.angle, t.tags,
           JSON.stringify({ perplexity_citations: result.citations?.slice?.(0, 5) ?? [],
                            generated_at: new Date().toISOString(),
                            model: result.model })]
        );
      }
      await client.query(
        `INSERT INTO run_log (workflow, level, message, meta)
         VALUES ('wf7_topic_refresh','info','persona topics refreshed via perplexity',
                 jsonb_build_object('inserted', $1::int, 'citations', $2::int))`,
        [insertable.length, (result.citations || []).length]
      );
      await client.query('COMMIT');
      console.log(`Inserted ${insertable.length} new persona topics.`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('topic_refresh failed:', err);
  process.exit(1);
});
