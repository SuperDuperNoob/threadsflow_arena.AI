// Integration test for the human-in-the-loop review/queue routes in services/kb/server.js.
//
// Boots the KB server as a child process against a fresh `tf_test` database (same instance
// used by the interactive checks) on an isolated port, then exercises:
//   - POST /api/login                 (auth cookie)
//   - POST /api/posts                 (insert a pending_review post via the DB directly)
//   - GET  /api/posts/queue           (lists the pending_review post)
//   - POST /api/posts/:id/lock        (locks it)
//   - POST /api/posts/:id/decision    (approves -> status flips, post_review row written)
//   - GET  /api/posts/weekly          (audit appears)
//   - GET  /api/review/queue          (alias, now empty)
//
// Requires a running Postgres that answers on /tmp (socket) port 5433 as user `threadsflow`,
// with a database named `tf_test` built from the repo migration+seed chain. This matches
// infra/.env.example and the dev container; on CI set the env vars below.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PGHOST = process.env.PGHOST || '/tmp';
const PGPORT = process.env.PGPORT || '5433';
const PGUSER = process.env.PGUSER || 'threadsflow';
const PGDATABASE = process.env.PGDATABASE || 'tf_test';
const PORT = Number(process.env.KB_TEST_PORT || 8137);
const KB_PASSWORD = 'testpass';
const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'kbtest-'));

const BASE = `http://127.0.0.1:${PORT}`;
let serverProc;
let cookie = '';

function psql(...args) {
  return execFileSync('psql', ['-h', PGHOST, '-p', PGPORT, '-U', PGUSER, '-d', PGDATABASE, '-P', 'pager=off', '-tAc', ...args], { encoding: 'utf8' });
}

function req(method, pathname, { body, cookie: ck } = {}) {
  const headers = { cookie: ck || cookie };
  let payload;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  return fetch(BASE + pathname, { method, headers, body: payload });
}

before(async () => {
  // Confirm the review status check actually includes the review lifecycle states.
  const chk = psql("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='posts_status_check';");
  assert.ok(/pending_review/.test(chk), 'posts_status_check must allow pending_review (migration 019 missing?)');
  assert.ok(/approved/.test(chk), 'posts_status_check must allow approved');
  assert.ok(/auto_published/.test(chk), 'posts_status_check must allow auto_published');

  // Insert a reviewable post directly (the HTTP intake requires Shopee enrichment we don't run here).
  // Reset to a clean pending_review state on every run so the test is idempotent.
  psql(`DELETE FROM posts WHERE uid='itest_pq1';`);
  psql(`INSERT INTO posts (uid,body,status,media_type,format,angle,tone,sell_intensity,length_band,scheduled_at,purpose,review_timeout_at)
        VALUES ('itest_pq1','Ini post ujian integration.','pending_review','TEXT','pov','story_arc','gaul',1,'mid',now(),'product',now()+interval '10 minutes');`);

  // Boot the server.
  const env = {
    ...process.env,
    DATABASE_URL: `postgres://${PGUSER}@/${PGDATABASE}?host=${PGHOST}&port=${PGPORT}`,
    PORT: String(PORT),
    KB_PASSWORD,
    KB_DATA_DIR: DATA_DIR,
    NODE_ENV: 'test',
  };
  serverProc = spawn('node', ['server.js'], { env, cwd: process.cwd(), stdio: ['ignore', 'inherit', 'inherit'] });
  // Wait for healthz.
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(BASE + '/healthz');
      if (r.ok) break;
    } catch { /* not up yet */ }
    await sleep(200);
  }

  // Login -> cookie.
  const login = await req('POST', '/api/login', { body: { password: KB_PASSWORD } });
  assert.equal(login.status, 200, 'login should succeed');
  const sc = login.headers.get('set-cookie') || '';
  cookie = sc.split(';')[0];
  assert.ok(cookie.startsWith('kb_session='), 'login must set kb_session cookie');
});

after(() => {
  if (serverProc) serverProc.kill('SIGINT');
});

test('unauthenticated review route is 401', async () => {
  const r = await fetch(BASE + '/api/posts/queue');
  assert.equal(r.status, 401);
});

test('queue lists the pending_review post, then approve flips status + writes audit', async () => {
  const q = await req('GET', '/api/posts/queue');
  assert.equal(q.status, 200);
  const list = await q.json();
  const match = list.find((p) => p.uid === 'itest_pq1');
  assert.ok(match, 'pending_review post should appear in queue');
  const id = match.id;

  const lock = await req('POST', `/api/posts/${id}/lock`);
  assert.equal(lock.status, 200);

  const dec = await req('POST', `/api/posts/${id}/decision`, { body: { decision: 'approved' } });
  assert.equal(dec.status, 200, 'decision approve should succeed');

  const status = psql(`SELECT status FROM posts WHERE uid='itest_pq1';`).trim();
  assert.equal(status, 'approved', 'post status should be approved after decision');

  const audit = psql(`SELECT decision, reviewed_by FROM post_review WHERE post_id=${id} ORDER BY created_at DESC LIMIT 1;`).trim();
  assert.ok(/approved\|operator/.test(audit), 'post_review should record approved/operator');

  const weekly = await req('GET', '/api/posts/weekly');
  const wk = await weekly.json();
  assert.ok(wk.recent_audits.some((a) => String(a.post_id) === String(id) && a.decision === 'approved'),
    'weekly summary should include the audit');

  const alias = await req('GET', '/api/review/queue');
  const aliasList = await alias.json();
  assert.ok(!aliasList.some((p) => p.uid === 'itest_pq1'), 'alias queue should no longer list the approved post');
});