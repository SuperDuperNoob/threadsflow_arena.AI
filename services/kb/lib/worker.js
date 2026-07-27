/**
 * Job worker. Polls kb_jobs, runs one ingest at a time.
 *
 * Deliberately serial: a 300-page book is ~45 LLM calls and holds a few hundred MB of parsed
 * text. Two concurrent books on a 2 vCPU / 4GB box will OOM. Queue depth is fine — you upload
 * a library once, not continuously.
 */

import os from 'node:os';
import { runIngest } from './pipeline.js';

const WORKER_ID = `${os.hostname()}-${process.pid}`;
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 4000);
const MAX_ATTEMPTS = 3;
const STALE_MIN = 45;

export async function startWorker(pool) {
  console.log(`worker ${WORKER_ID} started`);

  for (;;) {
    try {
      // reclaim jobs from a crashed worker
      await pool.query(`
        UPDATE kb_jobs SET state='pending', locked_at=NULL, locked_by=NULL
         WHERE state='running' AND locked_at < now() - ($1 || ' minutes')::interval`,
        [STALE_MIN]);

      // claim exactly one job atomically
      const { rows: [job] } = await pool.query(`
        UPDATE kb_jobs SET state='running', locked_at=now(), locked_by=$1,
                           attempts=attempts+1, updated_at=now()
         WHERE id = (
           SELECT id FROM kb_jobs WHERE state='pending'
            ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING *`, [WORKER_ID]);

      if (!job) { await sleep(POLL_MS); continue; }

      console.log(`[job ${job.id}] ingesting document ${job.document_id}`);
      const t0 = Date.now();
      try {
        const out = await runIngest({
          db: pool,
          documentId: job.document_id,
          log: m => console.log(`[job ${job.id}]${m}`),
        });
        await pool.query(`UPDATE kb_jobs SET state='done', updated_at=now() WHERE id=$1`, [job.id]);
        console.log(`[job ${job.id}] ${out.status} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      } catch (e) {
        console.error(`[job ${job.id}] failed:`, e.message);
        const dead = job.attempts >= MAX_ATTEMPTS;
        await pool.query(
          `UPDATE kb_jobs SET state=$2, last_error=$3, updated_at=now() WHERE id=$1`,
          [job.id, dead ? 'failed' : 'pending', e.message.slice(0, 800)]);
        if (dead) {
          await pool.query(
            `UPDATE kb_documents SET status='failed', error=$2, finished_at=now() WHERE id=$1`,
            [job.document_id, e.message.slice(0, 800)]);
        } else {
          await sleep(10_000);   // back off before the retry
        }
      }
    } catch (e) {
      console.error('worker loop error:', e.message);
      await sleep(POLL_MS * 3);
    }
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
