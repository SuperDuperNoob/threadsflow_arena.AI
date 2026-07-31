-- Migration 014: Add "follow request" persona topics for warm-up phase
--
-- Every 3 days during warm-up, one persona post is a "follow for follow" style post.
-- These are common among Malaysian affiliate accounts and help build initial followers.
-- The key is to sound natural, not pushy, and vary the wording so it doesn't feel repetitive.

BEGIN;

-- Create a new source for follow request topics
INSERT INTO persona_topic_sources (slug, label, description)
VALUES (
  'follow_request',
  'Follow Request Topics',
  'Natural "follow back" style posts for warm-up phase. Posted every 3 days to build initial followers.'
)
ON CONFLICT (slug) DO NOTHING;

-- Add 25 varieties of follow request topics
-- Each one has a different angle, tone, and approach to avoid repetition
INSERT INTO persona_topics (source_id, topic, angle_hint, time_of_day, context)
SELECT
  id,
  topic,
  angle,
  ARRAY[time_of_day]::TEXT[],
  jsonb_build_object('tone', tone, 'psychology_technique', psychology_technique)
FROM persona_topic_sources,
LATERAL (VALUES
  -- Casual & friendly
  ('Newbie kat Threads ni. Jom saling follow, I follow back tau 🤝', 'follow_request', 'gaul', 'evening', 'reciprocity_first'),
  ('Siapa nak I follow back? Komen sikit, nanti I visit profile korang', 'follow_request', 'warm_sibling', 'afternoon', 'participation_loop'),
  ('Baru join Threads. Nak kenal-kenal dengan orang Malaysia kat sini. Follow I, I follow balik', 'follow_request', 'gaul', 'morning', 'liking_through_specificity'),
  
  -- Question-based
  ('Korang follow I sebab apa eh? Content ke, vibe ke, saja-saja? Anyway I follow back siapa yang follow', 'follow_request', 'curious', 'evening', 'belonging_signal'),
  ('Ada tak yang macam I, follow orang pastu harap dia follow balik? Haha. Jom kita saling support', 'follow_request', 'gaul', 'afternoon', 'unity_shared_identity'),
  ('Soalan random: korang prefer follow orang yang post apa? I cuba macam-macam ni. Btw I follow back', 'follow_request', 'curious', 'midday', 'participation_loop'),
  
  -- Honest & direct
  ('I straight je cakap, I nak tambah followers. Tapi I follow balik, bukan jenis sombong', 'follow_request', 'deadpan', 'morning', 'reciprocity_first'),
  ('Nak grow account ni. Kalau korang follow, I follow back. Simple macam tu', 'follow_request', 'minimal', 'afternoon', 'liking_through_specificity'),
  ('Jujur cakap, baru start kat Threads. Harap dapat support dari korang. I follow back semua', 'follow_request', 'warm_sibling', 'evening', 'belonging_signal'),
  
  -- Community-focused
  ('Jom bina komuniti kecil kat sini. Follow I, I follow back, kita saling support content masing-masing', 'follow_request', 'warm_sibling', 'midday', 'unity_shared_identity'),
  ('Siapa kat sini suka content pasal [topik]? Follow I, nanti I share tips. Btw I follow back', 'follow_request', 'gaul', 'morning', 'liking_through_specificity'),
  ('Kita semua Malaysian kan? Jom saling follow, support local creators. I follow back tau', 'follow_request', 'warm_sibling', 'evening', 'belonging_signal'),
  
  -- Playful & fun
  ('Follow I kalau korang suka orang yang post random thoughts. I follow back, janji jangan ghost', 'follow_request', 'chaotic', 'afternoon', 'participation_loop'),
  ('I follow balik siapa follow I. Deal? 🤝 No hard feelings kalau tak follow balik', 'follow_request', 'gaul', 'morning', 'reciprocity_first'),
  ('Challenge: follow I, I follow back, pastu kita tengok siapa yang unfollow dulu. Haha gurau je', 'follow_request', 'chaotic', 'evening', 'participation_loop'),
  
  -- Value-based
  ('I share petua, tips, dan random thoughts. Kalau berminat, follow I. I follow back semua yang follow', 'follow_request', 'warm_sibling', 'midday', 'liking_through_specificity'),
  ('Nak share pengalaman [topik] kat sini. Follow kalau interested. Btw I follow back', 'follow_request', 'gaul', 'morning', 'liking_through_specificity'),
  ('I post pasal life, kerja, dan random stuff. Follow I kalau suka. I follow back tau', 'follow_request', 'gaul', 'afternoon', 'belonging_signal'),
  
  -- Gratitude-based
  ('Terima kasih yang dah follow I. I follow balik semua. Yang belum, jom follow, I follow back', 'follow_request', 'warm_sibling', 'evening', 'reciprocity_first'),
  ('Appreciate semua yang follow. I try follow back secepat mungkin. Yang baru, jom join', 'follow_request', 'warm_sibling', 'morning', 'reciprocity_first'),
  
  -- Conversational
  ('Korang rasa, better follow ramai-ramai ke sikit tapi quality? I currently follow back semua', 'follow_request', 'curious', 'afternoon', 'participation_loop'),
  ('Saja nak tanya, korang follow I sebab apa? Anyway I follow back, no worries', 'follow_request', 'gaul', 'midday', 'belonging_signal'),
  
  -- Short & sweet
  ('Follow I, I follow back. Simple', 'follow_request', 'minimal', 'morning', 'reciprocity_first'),
  ('Jom connect. Follow I, I follow balik', 'follow_request', 'gaul', 'evening', 'liking_through_specificity'),
  ('New here. Follow back semua yang follow I', 'follow_request', 'minimal', 'afternoon', 'reciprocity_first')
) AS v(topic, angle, tone, time_of_day, psychology_technique);

-- Add settings for follow request frequency (every 3 days during warm-up)
UPDATE settings
SET value = jsonb_set(
  value,
  '{persona_follow_request}',
  '{
    "enabled": true,
    "frequency_days": 3,
    "only_during_warmup": true,
    "slot_hour": 19,
    "slot_minute": 30
  }'::jsonb
)
WHERE key = 'warmup';

-- Log this migration
INSERT INTO run_log (workflow, level, message)
VALUES ('migration', 'info', 'Migration 014: Added 25 follow request persona topics for warm-up phase (every 3 days)');

COMMIT;
