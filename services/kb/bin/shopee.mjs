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
  generateShortLink,
  callShopee,
  configureShopee,
  ShopeeNotConfigured,
  ShopeeApiError,
} from '../lib/shopee.js';
import { pullConversions } from '../lib/shopee_conversions.js';

const [cmd, ...rest] = process.argv.slice(2);

async function check() {
  if (!(await isConfigured())) {
    console.error('NOT CONFIGURED — set SHOPEE_API_APP_ID and SHOPEE_API_SECRET (or a settings row).');
    process.exit(2);
  }
  console.log('Configured. Verifying signature with a sample productOfferV2 call...\n');
  try {
    const nodes = await searchProductOffers({ keyword: 'phone', limit: 1, sortType: 5 });
    console.log('OK. Sample offer:');
    console.log(JSON.stringify(nodes[0] ?? null, null, 2));
  } catch (e) {
    console.error('CALL FAILED:', e instanceof ShopeeApiError ? `code ${e.code}: ${e.message}` : e.message);
    process.exit(1);
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
  try {
    const data = await callShopee(q);
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('QUERY FAILED:', e instanceof ShopeeApiError ? `code ${e.code}: ${e.message}` : e.message);
    process.exit(1);
  }
}

const usage = () => {
  console.error('Usage: node bin/shopee.mjs <check|sync|query> [...args]');
  process.exit(2);
};

try {
  if (cmd === 'check') await check();
  else if (cmd === 'sync') await sync();
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
