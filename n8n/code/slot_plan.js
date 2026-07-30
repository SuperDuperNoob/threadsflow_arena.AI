/**
 * n8n Code node — wf2 step 1: build today's posting slots.
 * Output: one item per slot, each carrying scheduled_at + the breed/explore instruction.
 *
 * Rules encoded here:
 *  - 5 slots at the configured hours, each jittered ±18 min (never the same minute twice)
 *  - 8% chance a slot is skipped entirely — irregularity is an anti-detection feature
 *  - exactly 1 slot per day is forced to sell_intensity=0 (no link comment), and it is
 *    randomly placed, never always the same hour
 *  - slot order is consumed from next_cycle_plan (60% breed / 40% explore, pre-shuffled by wf4)
 */

const settings = $json.settings.posting;
const plan = $json.next_cycle_plan ?? [];
const tz = settings.timezone ?? 'Asia/Kuala_Lumpur';

const now = new Date();
const dayStart = new Date(now);
dayStart.setHours(0, 0, 0, 0);
dayStart.setDate(dayStart.getDate() + 1);   // generating for TOMORROW at 03:00

const slots = [];
const hours = settings.slot_hours;
const freeIdx = Math.floor(Math.random() * hours.length);   // which slot is non-commercial today

for (let i = 0; i < hours.length; i++) {
  if (Math.random() < (settings.skip_probability ?? 0.08)) continue;

  const jitter = Math.round((Math.random() * 2 - 1) * (settings.jitter_minutes ?? 18));
  const t = new Date(dayStart);
  t.setHours(hours[i], 0, 0, 0);
  t.setMinutes(t.getMinutes() + jitter);
  t.setSeconds(Math.floor(Math.random() * 60));

  const instruction = plan.shift() ?? { mode: 'explore' };

  slots.push({
    slot_index: i,
    scheduled_at: t.toISOString(),
    force_sell_intensity: i === freeIdx ? '0' : null,
    is_carousel: Math.random() < (settings.carousel_probability ?? 0.4),
    reply_delay_sec: Math.round(
      settings.reply_delay_range_sec[0] +
      Math.random() * (settings.reply_delay_range_sec[1] - settings.reply_delay_range_sec[0])
    ),
    plan: instruction,
    timezone: tz,
  });
}

// never leave a day with zero posts
if (slots.length === 0) {
  const t = new Date(dayStart); t.setHours(19, 12, 0, 0);
  slots.push({ slot_index: 3, scheduled_at: t.toISOString(), force_sell_intensity: null,
               is_carousel: false, reply_delay_sec: 70, plan: { mode: 'explore' }, timezone: tz });
}

// Carry the loaded settings/config forward. n8n Code nodes replace the item JSON by default;
// without spreading $json here, later nodes lose cfg.llm and cannot call the configured LLM.
return slots.map(s => ({ json: { ...$json, ...s, remaining_plan: plan } }));
