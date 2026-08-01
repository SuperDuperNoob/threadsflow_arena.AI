/**
 * Deployment / bootstrap regression tests.
 *
 * These cover the "one-click setup" path rather than the KB service itself.
 * Each test pins a bug that actually shipped:
 *
 *   1. init_db.sh and setup_new_vps.sh apply every db/migrations/*.sql on
 *      EVERY run, but two migrations exploded on the second run.
 *   2. Migration 014 cross-joined persona_topic_sources, attaching 25
 *      "follow me back" topics to all 5 sources (125 rows instead of 25).
 *   3. setup_new_vps.sh generated base64 secrets and injected them with
 *      `sed s/…/…/`; a '/' in the password broke sed, and a '/' or '@'
 *      corrupted DATABASE_URL.
 *   4. The Threads token upsert must create the settings row when absent
 *      (a plain UPDATE ... jsonb_set silently no-ops).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMigratedPostgres } from './migration-helper.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = 55470;

test('every migration is safe to re-run (init_db.sh replays them all)', async (t) => {
  const ctx = await startMigratedPostgres({ repoRoot, port: PORT });
  t.after(async () => {
    await ctx.stop();
    fs.rmSync(ctx.databaseDir, { recursive: true, force: true });
  });

  const migrations = fs
    .readdirSync(path.join(repoRoot, 'db/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const failed = [];
  for (const file of migrations) {
    const sql = fs.readFileSync(path.join(repoRoot, 'db/migrations', file), 'utf8');
    try {
      await ctx.client.query(sql);
    } catch (err) {
      failed.push(`${file}: ${err.message.split('\n')[0]}`);
      await ctx.client.query('ROLLBACK').catch(() => {});
    }
  }

  assert.deepEqual(failed, [], `migrations must be idempotent, but these failed on re-run:\n${failed.join('\n')}`);
});

test('follow-request topics attach only to the follow_request source', async (t) => {
  const ctx = await startMigratedPostgres({ repoRoot, port: PORT + 1 });
  t.after(async () => {
    await ctx.stop();
    fs.rmSync(ctx.databaseDir, { recursive: true, force: true });
  });

  const { rows } = await ctx.client.query(`
    SELECT s.slug, count(*)::int AS n
      FROM persona_topics t
      JOIN persona_topic_sources s ON s.id = t.source_id
     WHERE t.angle_hint = 'follow_request'
     GROUP BY s.slug`);

  assert.equal(rows.length, 1, `follow_request topics leaked onto: ${rows.map((r) => r.slug).join(', ')}`);
  assert.equal(rows[0].slug, 'follow_request');
  assert.equal(rows[0].n, 25);

  // Guard the ratio too: warm-up posts should not be majority "follow me back".
  const [{ pct }] = (await ctx.client.query(`
    SELECT round(100.0 * count(*) FILTER (WHERE angle_hint = 'follow_request') / count(*))::int AS pct
      FROM persona_topics`)).rows;
  assert.ok(pct <= 20, `follow_request topics are ${pct}% of the pool; expected <= 20%`);
});

test('threads token upsert creates the row and preserves sibling keys', async (t) => {
  const ctx = await startMigratedPostgres({ repoRoot, port: PORT + 2 });
  t.after(async () => {
    await ctx.stop();
    fs.rmSync(ctx.databaseDir, { recursive: true, force: true });
  });

  // Mirrors the statement in scripts/set_secrets.sh.
  const upsert = `
    INSERT INTO settings (key, value)
    VALUES ('threads_creds',
            jsonb_build_object('token', $1::text, 'user_id', $2::text,
                               'expires_at', (now() + interval '60 days')::text))
    ON CONFLICT (key) DO UPDATE
      SET value = settings.value
                  || jsonb_build_object('token', $1::text, 'user_id', $2::text,
                                        'expires_at', (now() + interval '60 days')::text);`;

  // Tokens are opaque; make sure quoting cannot break the statement.
  const tricky = `THQVJ-w'eird\\token"with$quotes`;
  await ctx.client.query(upsert, [tricky, '17841400000000000']);

  let value = (await ctx.client.query(`SELECT value FROM settings WHERE key='threads_creds'`)).rows[0].value;
  assert.equal(value.token, tricky, 'token must round-trip byte-for-byte');
  assert.equal(value.user_id, '17841400000000000');

  // wf0_token_refresh writes expires_at alongside; rotating must not drop it.
  await ctx.client.query(`UPDATE settings SET value = value || '{"note":"keep-me"}'::jsonb WHERE key='threads_creds'`);
  await ctx.client.query(upsert, ['ROTATED', '17841400000000000']);

  value = (await ctx.client.query(`SELECT value FROM settings WHERE key='threads_creds'`)).rows[0].value;
  assert.equal(value.token, 'ROTATED');
  assert.equal(value.note, 'keep-me', 'rotating the token must not clobber sibling keys');

  // The exact projection wf3_publish uses.
  const due = (await ctx.client.query(
    `SELECT value->>'token' AS token, value->>'user_id' AS user_id FROM settings WHERE key='threads_creds'`)).rows[0];
  assert.equal(due.token, 'ROTATED');
  assert.equal(due.user_id, '17841400000000000');
});

test('generated secrets are safe for sed and for the DATABASE_URL', () => {
  const setup = fs.readFileSync(path.join(repoRoot, 'scripts/setup_new_vps.sh'), 'utf8');

  // base64 emits / + = which break `sed s|…|` replacement and URL userinfo.
  const base64Secrets = setup.match(/^\s*(PG_PASSWORD|N8N_PASSWORD|KB_PASSWORD|IP_SALT|N8N_ENCRYPTION_KEY)=\$\(openssl rand -base64.*$/gm);
  assert.equal(base64Secrets, null, `secrets must be hex, not base64:\n${(base64Secrets || []).join('\n')}`);

  // The unanchored form `sed -i "s/placeholder/$VALUE/"` is the bug; require
  // key-anchored replacement with a '|' delimiter instead.
  const unanchored = setup.match(/sed -i "s\/[^"]*\$[A-Z_]+\/"/g);
  assert.equal(unanchored, null, 'secret injection must not use an unanchored s/…/…/ with a raw variable');

  // PG_PASSWORD is embedded in DATABASE_URL, so the two must be written together.
  assert.match(setup, /set_env DATABASE_URL\s+"postgres:\/\/threadsflow:\$\{PG_PASSWORD\}@postgres:5432\/threadsflow"/,
    'DATABASE_URL must be regenerated from the same PG_PASSWORD');

  // Simulate the generator: hex must survive both sed and URL parsing.
  for (let i = 0; i < 200; i += 1) {
    const pw = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('hex');
    assert.ok(/^[0-9a-f]+$/.test(pw), 'hex only');
    const url = new URL(`postgres://threadsflow:${pw}@postgres:5432/threadsflow`);
    assert.equal(url.password, pw, 'password must survive URL parsing');
  }
});

test('compose does not rely on removed n8n basic auth and pins the image', () => {
  const compose = fs.readFileSync(path.join(repoRoot, 'infra/docker-compose.yml'), 'utf8');

  // N8N_BASIC_AUTH_* was removed in n8n v1 and ignored in v2 — it protected nothing.
  assert.ok(!/^\s*N8N_BASIC_AUTH_ACTIVE:/m.test(compose),
    'N8N_BASIC_AUTH_* is a no-op on n8n v1+; do not imply the UI is protected by it');

  // `:latest` silently upgrades across the v1 -> v2 breaking-change boundary.
  const image = compose.match(/image:\s*docker\.n8n\.io\/n8nio\/n8n:(\S+)/);
  assert.ok(image, 'n8n image not found in compose');
  assert.ok(!image[1].includes('latest'), `n8n image must be pinned, found "${image[1]}"`);
});
