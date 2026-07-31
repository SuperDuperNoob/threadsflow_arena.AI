import test from 'node:test';
import assert from 'node:assert';
import qaModule from '../../../n8n/code/qa.js';
import scoringModule from '../../../n8n/code/scoring.js';

const qa = qaModule.qa;
const score = scoringModule.score;

test('qa.js rejects Indonesian slang words', () => {
  const badWords = ['banget', 'nggak', 'gak', 'aja', 'udah', 'bikin', 'gimana', 'kalian', 'doang', 'cowok', 'cewek', 'gue', 'deh', 'dong', 'sih'];
  
  for (const word of badWords) {
    const input = {
      text: `Produk ini memang bagus ${word} dan tahan lama untuk kegunaan harian di dapur. Harga RM39.90 sahaja.`,
      embedding: [0.1, 0.2, 0.3],
      recent: [],
      banned: [],
      length_band: 'mid',
      tone: 'gaul',
      sell_intensity: '1',
      product_details: ['RM39.90', 'tahan lama'],
      settings: { max_emoji: 2, max_similarity: 0.86 }
    };
    const result = qa(input);
    assert.strictEqual(result.pass, false, `Expected QA to fail for Indonesian word: ${word}`);
    assert.ok(
      result.reasons.some(r => r.includes('Indonesian')),
      `Expected reason to mention Indonesian for word: ${word}, got reasons: ${JSON.stringify(result.reasons)}`
    );
  }
});

test('qa.js passes clean Malaysian Malay text with concrete details', () => {
  const input = {
    text: 'Spatula silikon tahan panas sampai 230°C. Pemegang 11cm tak melekat pada kuali non-stick. Harga RM25 je untuk satu set.',
    embedding: [0.1, 0.2, 0.3],
    recent: [],
    banned: [],
    length_band: 'mid',
    tone: 'gaul',
    sell_intensity: '1',
    product_details: ['RM25', '230°C', '11cm'],
    settings: { max_emoji: 2, max_similarity: 0.86 }
  };
  const result = qa(input);
  assert.strictEqual(result.pass, true, `Expected QA to pass, got reasons: ${JSON.stringify(result.reasons)}`);
});

test('scoring.js incorporates human_feedback and respects eligibility gating', () => {
  const posts = [
    {
      id: 1, uid: 'p1', product_uid: 'prod1', format: 'flash_story', angle: 'social_proof',
      tone: 'gaul', sell_intensity: '1', length_band: 'mid', views: 500, clicks: 50, orders: 2,
      commission_myr: 10, likes: 5, replies: 1, reposts: 0, quotes: 0,
      human_feedback: 1.0, was_probe: false
    },
    {
      id: 2, uid: 'p2', product_uid: 'prod1', format: 'flash_story', angle: 'social_proof',
      tone: 'gaul', sell_intensity: '1', length_band: 'mid', views: 500, clicks: 50, orders: 2,
      commission_myr: 10, likes: 5, replies: 1, reposts: 0, quotes: 0,
      human_feedback: -1.0, was_probe: true
    },
    {
      id: 3, uid: 'p3', product_uid: 'prod1', format: 'flash_story', angle: 'social_proof',
      tone: 'gaul', sell_intensity: '1', length_band: 'mid', views: 50, clicks: 2, orders: 0,
      commission_myr: 0, likes: 1, replies: 0, reposts: 0, quotes: 0,
      human_feedback: 1.0, was_probe: false // under-distributed (eligible: false)
    }
  ];

  const settings = {
    scoring: { w_ctr: 0.25, w_eng: 0.2, w_epm: 0.55, w_human: 0.15, min_views: 200 },
    bandit: { money_shrinkage_target_orders: 20 }
  };

  const output = score({ posts, settings, lifetime_orders: 10 });
  
  assert.ok(output.scores, 'Expected scores in output');
  const s1 = output.scores.find(s => s.post_id === 1);
  const s2 = output.scores.find(s => s.post_id === 2);
  const s3 = output.scores.find(s => s.post_id === 3);

  // Post 1 (approved +1.0) should score higher than Post 2 (rejected -1.0)
  assert.ok(s1.final_score > s2.final_score, `Expected post 1 final_score (${s1.final_score}) > post 2 final_score (${s2.final_score})`);

  // Post 3 is ineligible (views 50 < 200), so its final_score must be clamped to <= -0.35 regardless of human_feedback = 1.0
  assert.ok(s3.final_score <= -0.35, `Expected ineligible post 3 final_score (${s3.final_score}) to be <= -0.35`);

  // Check lever report probe rejections count
  const formatReport = output.lever_report.format;
  assert.ok(formatReport, 'Expected format lever report');
  const flashStory = formatReport.find(f => f.code === 'flash_story');
  assert.ok(flashStory, 'Expected flash_story in lever report');
  assert.strictEqual(flashStory.probe_rejections, 1, `Expected 1 probe rejection, got ${flashStory.probe_rejections}`);
});
