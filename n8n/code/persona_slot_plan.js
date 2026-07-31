/**
 * n8n Code node — wf6 step 0: build today's persona posting slots.
 *
 * Output: one item per persona slot, with scheduled_at, length_band, tone, format,
 *         time_of_day, psychology_techniques.
 *
 * Rules:
 *  - Slots are placed at persona_slot_hours (defaults [7, 11, 16, 21] Kuala Lumpur time).
 *  - Each slot is jittered ±persona_jitter_min (default 22 min) for irregularity.
 *  - persona_skip_prob (default 8%) chance a slot is dropped — irregularity.
 *  - Length-band mix is configurable: micro/mid/long (default 25/60/15).
 *  - Tone is drawn from a persona-appropriate subset (no enthusiast, no corporate_parody —
 *    those read like influencers or parody accounts).
 *  - Format is drawn from persona-appropriate formats (confession, one_liner, chat_narration,
 *    overheard, list_of_three, question_hook) — no honest_review/diary/myth_bast/product frames.
 *  - Media type is always TEXT for persona posts (no product photos to attach).
 *  - Time-of-day affinity: morning slots prefer commute/breakfast topics, afternoon prefers
 *    petua/household, evening prefers food/family/reflection.
 *  - Psychology techniques: 1-2 techniques assigned per slot from the psychology seed pool,
 *    weighted toward persona-appropriate techniques (reciprocity, belonging, participation).
 */

const ALLOWED_TONES = ['deadpan', 'gaul', 'warm_sibling', 'chaotic', 'minimal', 'makcik'];
const ALLOWED_FORMATS = ['confession', 'one_liner', 'chat_narration', 'overheard',
                         'list_of_three', 'question_hook', 'pov', 'rant_bite', 'petua'];

// Time-of-day mapping from slot hours
const HOUR_TO_TIME_OF_DAY = {
  7: 'morning',
  11: 'midday',
  16: 'afternoon',
  21: 'evening',
};

// Psychology techniques suitable for persona posts (from seed_techniques_psychology.sql)
const PERSONA_PSYCHOLOGY_TECHNIQUES = [
  'reciprocity_first',       // give value before asking
  'liking_through_specificity', // name one specific shared detail
  'unity_shared_identity',   // name the group the reader belongs to
  'punctuation_signals_tone', // period = serious, no period = casual
  'clarity_over_cleverness', // one idea per sentence
  'write_like_you_talk',     // BM pasar contractions
  'cut_ruthlessly',          // every sentence must earn its place
  'participation_loop',      // ask for specific input
  'belonging_signal',        // "kita" for struggles, "saya" for wins
];

// Technique weights by time of day (some techniques work better at certain times)
const TECHNIQUE_TIME_WEIGHTS = {
  morning:   { reciprocity_first: 1.2, belonging_signal: 1.0, participation_loop: 0.8 },
  midday:    { clarity_over_cleverness: 1.3, write_like_you_talk: 1.2, cut_ruthlessly: 1.1 },
  afternoon: { reciprocity_first: 1.3, liking_through_specificity: 1.2, participation_loop: 1.1 },
  evening:   { belonging_signal: 1.4, unity_shared_identity: 1.3, participation_loop: 1.2 },
};

const DEFAULT_SETTINGS = {
  persona_slot_hours: [7, 11, 16, 21],
  persona_jitter_min: 22,
  persona_skip_prob: 0.08,
  persona_micro_pct: 0.25,
  persona_mid_pct: 0.60,
  persona_long_pct: 0.15,
  timezone: 'Asia/Kuala_Lumpur',
};

function pickWeighted(rng, pairs) {
  const total = pairs.reduce((s, p) => s + p.w, 0);
  let r = rng() * total;
  for (const p of pairs) { r -= p.w; if (r <= 0) return p.v; }
  return pairs[pairs.length - 1].v;
}

function buildPersonaSlots(opts = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...(opts.settings ?? {}) };
  const now = new Date();
  const tz = settings.timezone ?? 'Asia/Kuala_Lumpur';

  // We run at 03:30 (after wf2's 03:00 product generation finishes), so slots are for TODAY or
  // TOMORROW depending on hour. For simplicity: if before 05:00 local, generate for today;
  // otherwise for tomorrow.
  const d = new Date(now);
  // Compute local hour in timezone.
  const localHourStr = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit', hour12: false, timeZone: tz,
  }).format(d);
  const localHour = Number(localHourStr) % 24;
  if (localHour >= 5) d.setDate(d.getDate() + 1);
  // Set to midnight local time in the timezone.
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz,
  }).formatToParts(d);
  const y = Number(parts.find(p => p.type === 'year').value);
  const m = Number(parts.find(p => p.type === 'month').value) - 1;
  const day = Number(parts.find(p => p.type === 'day').value);
  const dayStart = new Date(Date.UTC(y, m, day, 0, 0, 0));
  // UTC offset for the timezone at that date — this gives us the right UTC start.
  const tzOffsetMs = (() => {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const parts2 = dtf.formatToParts(new Date(Date.UTC(y, m, day, 12, 0, 0)));
    const obj = {};
    for (const p of parts2) obj[p.type] = Number(p.value);
    const asUtc = Date.UTC(obj.year, obj.month - 1, obj.day, obj.hour % 24, obj.minute, obj.second);
    return asUtc - Date.UTC(obj.year, obj.month - 1, obj.day, 12, 0, 0);
  })();
  const localMidnight = new Date(dayStart.getTime() - tzOffsetMs);

  const slots = [];
  const hours = settings.persona_slot_hours;
  for (let i = 0; i < hours.length; i++) {
    if (Math.random() < (settings.persona_skip_prob ?? 0.08)) continue;

    const jitter = Math.round((Math.random() * 2 - 1) * (settings.persona_jitter_min ?? 22));
    const t = new Date(localMidnight);
    t.setHours(hours[i], 0, 0, 0);
    t.setMinutes(t.getMinutes() + jitter);
    t.setSeconds(Math.floor(Math.random() * 60));

    const r = Math.random();
    let length_band = 'mid';
    if (r < settings.persona_micro_pct) length_band = 'micro';
    else if (r < settings.persona_micro_pct + settings.persona_mid_pct) length_band = 'mid';
    else length_band = 'long';

    // Tone: simple uniform draw from allowed set. Bandit scoring will update post-hoc via
    // wf4 extension — we extend topic bandit first; tone selection stays uniform for personas
    // until we have enough samples per tone on persona posts to learn.
    const tone = ALLOWED_TONES[Math.floor(Math.random() * ALLOWED_TONES.length)];
    const format = ALLOWED_FORMATS[Math.floor(Math.random() * ALLOWED_FORMATS.length)];

    // Time of day (from hour)
    const time_of_day = HOUR_TO_TIME_OF_DAY[hours[i]] || 'afternoon';

    // Psychology techniques (1-2 techniques, weighted by time of day)
    const techniqueCount = Math.random() < 0.3 ? 2 : 1; // 30% chance of 2 techniques
    const psychology_techniques = pickPersonaTechniques(time_of_day, techniqueCount);

    slots.push({
      slot_index: i,
      scheduled_at: t.toISOString(),
      length_band,
      tone,
      format,
      time_of_day,
      psychology_techniques,
      angle: 'utility',           // personas aren't selling; 'utility' is "one small useful/true thing"
      sell_intensity: '0',        // never any CTA
      media_type: 'TEXT',
      is_carousel: false,
      reply_delay_sec: 0,
      purpose: 'persona',
      timezone: tz,
    });
  }

  // Never produce zero persona slots (guards against 8% skip rolling all 4 slots).
  if (slots.length === 0) {
    const t = new Date(localMidnight);
    t.setHours(20, 12, Math.floor(Math.random() * 60), 0);
    slots.push({
      slot_index: 0, scheduled_at: t.toISOString(),
      length_band: 'mid', tone: 'gaul', format: 'one_liner',
      time_of_day: 'evening',
      psychology_techniques: pickPersonaTechniques('evening', 1),
      angle: 'utility', sell_intensity: '0', media_type: 'TEXT',
      is_carousel: false, reply_delay_sec: 0, purpose: 'persona', timezone: tz,
    });
  }

  // Follow request posts: every 3 days during warm-up phase
  const followRequestSettings = settings.persona_follow_request || {};
  if (followRequestSettings.enabled !== false) {
    const frequencyDays = followRequestSettings.frequency_days || 3;
    const onlyDuringWarmup = followRequestSettings.only_during_warmup !== false;
    const slotHour = followRequestSettings.slot_hour ?? 19;
    const slotMinute = followRequestSettings.slot_minute ?? 30;

    // Check if we're in warm-up phase (first 30 days: 14 days warmup + 16 days ramp)
    const isWarmup = !onlyDuringWarmup || isWarmupPhase(settings);

    if (isWarmup) {
      // Check if today is a follow request day (day 0, 3, 6, 9, etc.)
      const daysSinceStart = getDaysSinceWarmupStart(settings);
      const isFollowRequestDay = daysSinceStart % frequencyDays === 0;

      if (isFollowRequestDay) {
        const t = new Date(localMidnight);
        t.setHours(slotHour, slotMinute, Math.floor(Math.random() * 60), 0);

        // Pick a random tone from allowed tones (gaul/warm_sibling/curious work well)
        const followTones = ['gaul', 'warm_sibling', 'curious', 'deadpan', 'chaotic', 'minimal'];
        const tone = followTones[Math.floor(Math.random() * followTones.length)];

        // Pick a psychology technique suited for follow requests
        const followTechniques = ['reciprocity_first', 'belonging_signal', 'participation_loop', 'liking_through_specificity'];
        const psychology_techniques = [followTechniques[Math.floor(Math.random() * followTechniques.length)]];

        slots.push({
          slot_index: slots.length,
          scheduled_at: t.toISOString(),
          length_band: 'short',  // follow requests are usually short
          tone,
          format: 'direct_ask',  // new format for follow requests
          time_of_day: HOUR_TO_TIME_OF_DAY[slotHour] || 'evening',
          psychology_techniques,
          angle: 'follow_request',
          sell_intensity: '0',
          media_type: 'TEXT',
          is_carousel: false,
          reply_delay_sec: 0,
          purpose: 'persona',
          timezone: tz,
        });
      }
    }
  }

  return slots;
}

/**
 * Check if we're currently in warm-up phase (first 30 days).
 */
function isWarmupPhase(settings) {
  const warmup = settings.warmup || {};
  if (!warmup.enabled || !warmup.started_at) return false;

  const startDate = new Date(warmup.started_at);
  const now = new Date();
  const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));

  // Warm-up is 14 days + ramp is 16 days = 30 days total
  return daysSinceStart < 30;
}

/**
 * Get the number of days since warm-up started.
 */
function getDaysSinceWarmupStart(settings) {
  const warmup = settings.warmup || {};
  if (!warmup.started_at) return 0;

  const startDate = new Date(warmup.started_at);
  const now = new Date();
  return Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
}

/**
 * Pick 1-2 psychology techniques for a persona slot, weighted by time of day.
 */
function pickPersonaTechniques(timeOfDay, count = 1) {
  const weights = TECHNIQUE_TIME_WEIGHTS[timeOfDay] || {};
  const weighted = PERSONA_PSYCHOLOGY_TECHNIQUES.map(t => ({
    name: t,
    weight: weights[t] || 1.0,
  }));

  const selected = [];
  const pool = [...weighted];

  for (let i = 0; i < count && pool.length > 0; i++) {
    const totalWeight = pool.reduce((sum, item) => sum + item.weight, 0);
    let rand = Math.random() * totalWeight;

    for (let j = 0; j < pool.length; j++) {
      rand -= pool[j].weight;
      if (rand <= 0) {
        selected.push(pool[j].name);
        pool.splice(j, 1);
        break;
      }
    }
  }

  return selected;
}

// n8n entry point: receives $json with `settings` (or falls back to defaults).
if (typeof $ !== 'undefined' && typeof $json !== 'undefined') {
  const slots = buildPersonaSlots({ settings: $json.warmup ?? $json.settings ?? {} });
  return slots.map(s => ({ json: { ...$json, ...s } }));
}

if (typeof module !== 'undefined') {
  module.exports = { buildPersonaSlots, ALLOWED_TONES, ALLOWED_FORMATS };
}
