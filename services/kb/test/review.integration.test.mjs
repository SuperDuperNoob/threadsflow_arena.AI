import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { startMigratedPostgres } from './migration-helper.mjs';

const repoRoot = path.resolve(new URL('../../../', import.meta.url).pathname);
const serviceRoot = path.join(repoRoot, 'services/kb');

async function waitForHealth(baseUrl) {
  let lastError;
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      if (res.ok && (await res.text()) === 'ok') return;
    } catch (e) {
      lastError = e;
    }
    await delay(100);
  }
  throw lastError ?? new Error('server did not become healthy');
}

test('clean migration chain supports live post review routes', { timeout: 120_000 }, async (t) => {
  const pgPort = 55550 + Number(process.env.NODE_TEST_WORKER_ID ?? 0);
  const appPort = 18080 + Number(process.env.NODE_TEST_WORKER_ID ?? 0);
  const db = await startMigratedPostgres({ repoRoot, port: pgPort });
  t.after(async () => { await db.stop(); });

  const server = spawn(process.execPath, ['server.js'], {
    cwd: serviceRoot,
    env: {
      ...process.env,
      DATABASE_URL: db.connectionString,
      PORT: String(appPort),
      KB_PASSWORD: 'integration-secret',
      STORAGE_DIR: path.join(db.databaseDir, 'pdfs'),
      IMAGE_DIR: path.join(db.databaseDir, 'images'),
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  server.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  server.stderr.on('data', (chunk) => { logs += chunk.toString(); });
  t.after(async () => {
    server.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => server.once('exit', resolve)),
      delay(2000).then(() => server.kill('SIGKILL')),
    ]);
  });

  const baseUrl = `http://127.0.0.1:${appPort}`;
  await waitForHealth(baseUrl);

  const login = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'integration-secret' }),
  });
  assert.equal(login.status, 200, logs);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);

  const inserted = await db.client.query(`
    INSERT INTO posts (uid, media_type, format, angle, tone, sell_intensity, length_band,
                       body, char_count, emoji_count, hashtag_used, status, scheduled_at,
                       review_timeout_at, review_timeout_minutes)
    VALUES ('itest_review_1', 'TEXT', 'story', 'practical', 'gaul', 1, 'micro',
            'Test post for human review route', 32, 0, false, 'pending_review',
            now() + interval '1 hour', now() + interval '30 minutes', 30)
    RETURNING id;
  `);
  const postId = inserted.rows[0].id;

  const queue = await fetch(`${baseUrl}/api/posts/queue`, { headers: { cookie } })
    .catch((error) => { throw new Error(`${error.message}\nserver logs:\n${logs}`); });
  const queueText = await queue.text();
  assert.equal(queue.status, 200, queueText);
  const queueRows = JSON.parse(queueText);
  assert.ok(queueRows.some((row) => Number(row.id) === Number(postId)));

  const decision = await fetch(`${baseUrl}/api/posts/${postId}/decision`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ decision: 'approved', reason_note: 'integration test approval' }),
  });
  const decisionText = await decision.text();
  assert.equal(decision.status, 200, decisionText);
  assert.deepEqual(JSON.parse(decisionText), { ok: true });

  const review = await db.client.query('SELECT decision, reviewed_by FROM post_review WHERE post_id=$1 ORDER BY id DESC LIMIT 1', [postId]);
  assert.equal(review.rows[0].decision, 'approved');
  assert.equal(review.rows[0].reviewed_by, 'operator');

  const weekly = await fetch(`${baseUrl}/api/posts/weekly`, { headers: { cookie } });
  const weeklyText = await weekly.text();
  assert.equal(weekly.status, 200, weeklyText);
  const weeklyJson = JSON.parse(weeklyText);
  assert.ok(Array.isArray(weeklyJson.arm_stats));
  assert.ok(weeklyJson.recent_audits.some((row) => Number(row.post_id) === Number(postId)));

  const queueHtml = await fetch(`${baseUrl}/queue.html`, { headers: { cookie } });
  assert.equal(queueHtml.status, 200);
  assert.match(await queueHtml.text(), /Review Queue/);
});
