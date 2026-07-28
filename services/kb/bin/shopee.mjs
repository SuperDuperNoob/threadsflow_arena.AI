#!/usr/bin/env node
/**
 * Shopee Affiliate Open API — command line helper.
 *
 *   node bin/shopee.mjs check                       # verify keys + signature by a sample call
 *   node bin/shopee.mjs sync [--validate]            # pull last 7d of conversions into Postgres
 *   node bin/shopee.mjs query '{ ...graphql... }'    # run an arbitrary GraphQL query
 *   node bin/shopee.mjs query path/to/query.graphql # ...or read it from a file
 *
 * Needs: SHOPEE_API_APP_ID + SHOPEE_API_SECRET (env or settings table).
 * `sync` also needs DATABASE_URL. Override the window with SHOPEE_LOOKBACK_DAYS.
 */

import fs from 'node:fs/promises';
import pg from 'pg';
import {
  isConfigured,
  searchProductOffers,
  callShopee,
  registerShopeePool,
  ShopeeNotConfigured,
  ShopeeApiError,
} from '../lib/shopee.js';
import { pullConversions } from '../lib/shopee_conversions.js';

const [cmd, ...rest] = process.argv.slice(2);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Long-running mode for the `shopee-sync` container: pulls conversions every 12h
 * (with jitter) and never exits, so `docker compose up` keeps money data flowing
 * with no manual command. Self-heals: if keys/DB are missing it logs and retries.
 */
async function cron() {
  const lookbackDays = Number(process.env.SHOPEE_LOOKBACK_DAYS || 7);
  const includeValidated = Boolean(process.env.SHOPEE_VALIDATION_ID);
  const validationId = Number(process.env.SHOPEE_VALIDATION_ID || 0) || null;
  const intervalMs = 12 * 60 * 60 * 1000;

  console.log(
    `[shopee-sync] cron started — lookback=${lookbackDays}d, validated=${includeValidated}, every 12h`,
  );
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const url = process.env.DATABASE_URL;
      if (!url) {
        console.error('[shopee-sync] DATABASE_URL is required — retry in 1h.');
        await sleep(60 * 60 * 1000);
        continue;
      }
      const pool = new pg.Pool({ connectionString: url });
      // Register before checking configuration so settings-table credentials really work.
      // Previously cron checked first, while the Shopee client had no pool to read settings from.
      registerShopeePool(pool);
      if (!(await isConfigured())) {
        await pool.end();
        console.log('[shopee-sync] keys not set (env or settings table) — retry in 1h.');
        await sleep(60 * 60 * 1000);
        continue;
      }
      try {
        const out = await pullConversions({
          pool,
          lookbackDays,
          includeValidated,
          validationId: includeValidated ? validationId : null,
        });
        console.log('[shopee-sync]', JSON.stringify(out));
      } finally {
        await pool.end();
      }
    } catch (e) {
      console.error(
        '[shopee-sync] error:',
        e instanceof ShopeeApiError ? `code ${e.code}: ${e.message}` : e.message,
      );
    }
    const jitter = (Math.random() - 0.5) * 40 * 60 * 1000; // +/- 20 min
    await sleep(intervalMs + jitter);
  }
}

async function check() {
  const pool = process.env.DATABASE_URL
    ? new pg.Pool({ connectionString: process.env.DATABASE_URL })
    : null;
  if (pool) registerShopeePool(pool);
  try {
    if (!(await isConfigured())) {
      console.error('NOT CONFIGURED — set SHOPEE_API_APP_ID and SHOPEE_API_SECRET (or a settings row).');
      process.exitCode = 2;
      return;
    }
    console.log('Configured. Verifying signature with a sample productOfferV2 call...\n');
    const nodes = await searchProductOffers({ keyword: 'phone', limit: 1, sortType: 5 });
    console.log('OK. Sample offer:');
    console.log(JSON.stringify(nodes[0] ?? null, null, 2));
  } catch (e) {
    console.error('CALL FAILED:', e instanceof ShopeeApiError ? `code ${e.code}: ${e.message}` : e.message);
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}

async function sync() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required for sync.');
    process.exit(2);
  }
  const includeValidated = rest.includes('--validate');
  const validationId = Number(process.env.SHOPEE_VALIDATION_ID || 0) || null;
  const lookbackDays = Number(process.env.SHOPEE_LOOKBACK_DAYS || 7);

  const pool = new pg.Pool({ connectionString: url });
  registerShopeePool(pool);
  try {
    if (!(await isConfigured())) {
      console.error('NOT CONFIGURED — set SHOPEE_API_APP_ID and SHOPEE_API_SECRET first.');
      process.exit(2);
    }
    const out = await pullConversions({
      pool,
      lookbackDays,
      includeValidated,
      validationId: includeValidated ? validationId : null,
    });
    console.log('Sync complete:', JSON.stringify(out));
  } catch (e) {
    console.error('SYNC FAILED:', e instanceof ShopeeApiError ? `code ${e.code}: ${e.message}` : e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

async function query() {
  const arg = rest.join(' ').trim();
  let q = arg;
  // If it doesn't look like a GraphQL document, try to read it as a file path.
  if (!/^\s*[{(]/.test(q)) {
    try {
      q = (await fs.readFile(arg, 'utf8')).trim();
    } catch {
      console.error('Argument is neither a GraphQL document nor a readable file:', arg);
      process.exit(2);
    }
  }
  const pool = process.env.DATABASE_URL
    ? new pg.Pool({ connectionString: process.env.DATABASE_URL })
    : null;
  if (pool) registerShopeePool(pool);
  try {
    const data = await callShopee(q);
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('QUERY FAILED:', e instanceof ShopeeApiError ? `code ${e.code}: ${e.message}` : e.message);
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}

const usage = () => {
  console.error('Usage: node bin/shopee.mjs <check|sync|query> [...args]');
  process.exit(2);
};

try {
  if (cmd === 'check') await check();
  else if (cmd === 'sync') await sync();
  else if (cmd === 'cron') await cron();
  else if (cmd === 'query') await query();
  else usage();
} catch (e) {
  if (e instanceof ShopeeNotConfigured) {
    console.error(e.message);
    process.exit(2);
  }
  console.error(e);
  process.exit(1);
}
