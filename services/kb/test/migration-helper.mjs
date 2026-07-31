import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

export function sqlFiles(repoRoot) {
  return [
    'db/schema.sql',
    'db/schema_techniques.sql',
    'db/schema_kb.sql',
    'db/seed_levers_my.sql',
    'db/seed_techniques_my.sql',
    'db/mining_questions.sql',
    ...fs.readdirSync(path.join(repoRoot, 'db/migrations'))
      .filter((file) => file.endsWith('.sql'))
      .sort()
      .map((file) => `db/migrations/${file}`),
    'db/seed_techniques_books.sql',
    'db/seed_techniques_2026_threads.sql',
    'db/seed_techniques_psychology.sql',
  ];
}

export async function startMigratedPostgres({ repoRoot, port, log = false }) {
  const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'threadsflow-pg-'));
  const pg = new EmbeddedPostgres({
    databaseDir,
    user: 'threadsflow',
    password: 'threadsflow',
    port,
    persistent: false,
    onLog: log ? (message) => process.stdout.write(String(message)) : () => {},
    onError: log ? (message) => process.stderr.write(String(message)) : () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('threadsflow');
  const client = pg.getPgClient('threadsflow');
  await client.connect();

  for (const file of sqlFiles(repoRoot)) {
    const sql = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    await client.query(sql);
  }

  return {
    pg,
    client,
    databaseDir,
    connectionString: `postgres://threadsflow:threadsflow@127.0.0.1:${port}/threadsflow`,
    async stop() {
      await client.end().catch(() => {});
      await pg.stop().catch(() => {});
    },
  };
}
