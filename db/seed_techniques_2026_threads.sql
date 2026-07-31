-- TECHNIQUES MINED FROM NEW Books/ additions (2026 Threads Mastery series, Kopi Writing,
-- Ayat Jualan Menarik Pelanggan, source-copywriting-30-point, Teknik Mudah Ayat Jualan,
-- Mudahnya Jual Produk Kurang 7 Saat, Ebook-AJMP).
--
-- Editorial rules match seed_techniques_books.sql: extract MECHANISMS, reject hard-sell
-- surface style, add harmful patterns to banned_phrases, mark contradictions as contested.
--
-- Run ON TOP of seed_techniques_my.sql and seed_techniques_books.sql. ON CONFLICT DO NOTHING.

-- ── Source: register a fourth source bucket for the new 2026 Threads crop.
INSERT INTO technique_sources (title, author, notes) VALUES
('Books/ (2026 Threads Affiliate Mastery series)', 'Hizami Radzi (Threads Income Mastery v2, Threads Content Machine Playbook, Threads Profit Killer, Bonus Hook Berhantu v2)',
 '2026-edition Threads affiliate playbooks written in BM pasar. Strategy-level rules (HVCT structure, niche positioning, reply-marketing, algorithm anti-patterns) extracted; headline-template spam rejected.'),
('Books/ (Classic Malay copywriting — Kopi Writing, AJMP, 30-point, Teknik Mudah, Kurang 7 Saat)',
 'Haszoor Muaidi, Umar Taib, Izwan Wahab, Aidi Safaruddin, Aqif Azizan',
 'Pre-2020 FB-ads/WhatsApp copywriting books. Mechanisms borrowed: voice-of-prospect openers, three-second benefit bullet, pain-point→dream→offer sequence, reply-marketing. Hard-sell language (PM sekarang, percuma, RAHSIA) rejected as banned phrases.')
ON CONFLICT (title) DO NOTHING;

-- ── Techniques
INSERT INTO techniques
  (code, name, type, instruction, when_to_use, mechanism, example_do, example_dont,
   compatible_formats, compatible_tones, compatible_intensity, compatible_media,
   contested, contested_note, source_id, corroboration, review_state)
SELECT
  code, name, type, instruction, when_to_use, mechanism, example_do, example_dont,
  compatible_formats::TEXT[], compatible_tones::TEXT[], compatible_intensity::SMALLINT[], compatible_media::TEXT[],
  contested, contested_note, source_id, corroboration, review_state
FROM (VALUES

-- ══════════════════════════════════════════════════════════════════════════════
-- FROM: Threads Income Mastery v2 (2026), Threads Content Machine Playbook, Threads Profit Killer
-- ══════════════════════════════════════════════════════════════════════════════

('ghost_hook_v2','The Ghost Hook 2026','hook',
 'Open by naming a RESULT or a small mysterious change in the reader''s day without naming the product, brand, or category for at least two lines.',
 'One-liners, POV and myth-bust posts where the link sits in the first comment.',
 'Threads affiliate guide 2026: naming a category instantly flags the post as an ad. Naming a result triggers curiosity without the pattern-match. The reader self-identifies as "someone who needs this" before they know what "this" is.',
 'Tak sangka RM15 boleh kemaskan meja yang bersepah sejak PKP.',
 'Kalau korang nak beli cable organizer saya suggest beli yang ni.',
 '{one_liner,pov,myth_bust}','{deadpan,gaul,minimal,chaotic}','{0,1}','{}',
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (2026 Threads%'),2,'approved'),

('hvct_structure','HVCT: Hook→Value→Conflict→Takeaway','structure',
 'Build the post in four beats in order: 1) one-line hook (pain/surprise), 2) 1–2 lines of genuine value the reader can steal even without buying, 3) one line of small relatable drama/struggle, 4) one-line takeaway that points to a comment, never the body.',
 'Every post longer than 180 chars. This is the 2026 Threads structure recommended across all three 2026 ebooks.',
 'Content Machine Playbook: Hook→Value→Conflict→Takeaway mirrors the pattern humans tell stories in. Skip any one beat and the post either feels like a broadcast (missing Conflict), a lesson (missing Hook), or a rant (missing Value/Takeaway).',
 'Buka peti ais, bau hanyir.\\nBersihkan satu-satu, rupanya satu lobak merah terperuk di belakang.\\nTiga hari saya cari sumber bau.\\nBenda kecik yang buat dapur rasa bersih: peti ais yang tak berbau.',
 'Hai korang. Hari ini saya nak share satu produk yang sangat bagus untuk membersihkan peti ais anda.',
 '{confession,flash_story,diary,list_of_three}','{gaul,warm_sibling,deadpan}','{0,1}','{}',
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (2026 Threads%'),3,'approved'),

('reply_marketing','Reply as the growth channel','psychology',
 'After posting, stay online for 20 minutes and reply to every comment with at least one follow-up question or additional detail — never just "terima kasih". Ask for one piece of their context.',
 'Every non-micro post. This is the single highest-ROI engagement action the 2026 guides call out.',
 'Threads Profit Killer "mistake #6 — Post & Ghost": algorithms use reply density in the first 30 minutes as a ranking signal, and commenters who receive a genuine reply are 3–4× more likely to click the link. Short replies read as broadcast; a question turns a comment into a conversation, which triggers more distribution.',
 'Comment: "RM15 je? Beli kat mana?"\\nReply: "Shopee — nak link? Warna apa yang kau cari, sebab yang hitam selalu out of stock."',
 'Comment: "Beli kat mana?"\\nReply: "Link kat bio ya."',
 '{}','{gaul,warm_sibling,chaotic}','{0,1,2}','{}',
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (2026 Threads%'),3,'approved'),

('niche_positioning','Niche down to one exact person','psychology',
 'Open or close the post by naming ONE very specific kind of person (housing-type+problem or job+pain) rather than "korang semua".',
 'All posts except pure rant/luahan. Enforced via the writer prompt; this row is here for the bandit to measure.',
 'Threads Income Mastery Bab 2 Setup Profil: a bio or hook aimed at everyone is converted by nobody. Naming one specific person ("fresh grad gaji RM2.5k", "ibu 2 anak rumah flat") is what makes strangers stop and think "ini untuk aku".',
 'Ibu rumah flat yang dapur takde hood — boleh cuma buka tingkap dan tutup api 30 saat awal.',
 'Sesuai untuk semua orang yang mahu menjimatkan masa di dapur.',
 '{pov,confession,utility}','{gaul,warm_sibling}','{0,1}','{}',
 true,'Contra some storytelling books which recommend universal relatability; the 2026 Threads guides argue hyper-specific audiences outperform broad ones. Bandit decides.',
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (2026 Threads%'),2,'approved'),

('three_second_win','The 3-second bullet','hook',
 'Lead with one short (<9-word) sentence that states either the amount saved, the time saved, or a single before/after number.',
 'Honest reviews and before/after posts where a real measurement exists.',
 'Mudahnya Jual Produk Kurang 7 Saat: buyers give an opening 3 seconds. In 3 seconds they can read about 7–9 words; a number is the fastest way to land a concrete claim and stop the scroll. This is the shorter, Threads-native version of transformation_numbers.',
 'RM39. 4 bulan. Tak melekit lagi.',
 'Produk ini sangat berkualiti tinggi dan berbaloi untuk dimiliki.',
 '{one_liner,honest_review,before_after}','{deadpan,minimal,gaul}','{1,2}','{}',
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (2026 Threads%'),2,'approved'),

('anti_post_and_ghost','Never Post & Ghost (rule)','anti_pattern',
 'After any post that asks a question or takes a position, monitor comments for the first 20 minutes and reply substantively to at least the first 3. Never schedule and walk away.',
 'Always. This is a rule, not a technique.',
 'Profit Killer mistake #6: "Post & Ghost" is named as one of seven mistakes that silently kill conversion even when every other part of the funnel is correct. The first-reply window is what Threads uses to decide whether to push the post further.',
 '(procedure: L4 reply loop handles this; this technique exists as a rule/reminder, not as a writer instruction.)',
 'Jadual auto-post dan biarkan.',
 '{}','{}','{0,1,2}','{}',
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (2026 Threads%'),2,'approved'),

('zero_sell_ratio','The 1-in-4 zero-sell rule','structure',
 'Exactly one post in four should contain no mention of a product, no price, and no link. These posts ask a question, share a petua, or vent about something unrelated to selling.',
 'Account-level cadence. Already partially enforced by the daily free slot + wf6 persona posts. This technique exists so the bandit can measure it.',
 'Content Machine Playbook pillar 1: accounts where every post sells look like catalogues; catalogues get throttled. One value-only post in four is the floor, not the ceiling. wf6_persona produces these; this row lets wf4 score the ratio.',
 '(see wf6 persona posts for examples; they are pure value/no link.)',
 'Setiap hari 5 posts semua dengan link di bio.',
 '{}','{}','{0}','{}',
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (2026 Threads%'),3,'approved'),

-- ══════════════════════════════════════════════════════════════════════════════
-- FROM: Kopi Writing / AJMP / 30-point / Teknik Mudah / Kurang 7 Saat (classic BM copy)
-- ══════════════════════════════════════════════════════════════════════════════

('voice_of_prospect','Write in the prospect''s own complaint','hook',
 'Open with a sentence the reader has literally said out loud to a friend this week — word-for-word, in BM pasar, before any mention of a product.',
 'Confession, POV and rant formats. Works especially well in gaul/warm_sibling tones.',
 'Ayat Jualan Menarik Pelanggan (Umar Taib) langkah 1: dengar luahan prospek, then open with that exact sentence. It bypasses ad-detectors because it sounds like a friend complaining, not a seller pitching. This is the pre-AI version of what the persona-snippets dataset tries to do, but as an explicit writer instruction.',
 '"Kepala tengah serabut la Pak Kodi, mata dah la mengantuk." — buka dengan ayat ini sebelum cerita penyelesaiannya.',
 'Adakah anda menghadapi masalah dapur yang bersepah?',
 '{pov,confession,overheard,chat_narration}','{gaul,warm_sibling,chaotic}','{0,1}','{}',
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Classic Malay copywriting%'),3,'approved'),

('benefit_under_nine_words','Lead benefit in <9 words','hook',
 'Before any explanation, state the single most important benefit in one short phrase — under nine words, with a number if possible.',
 'One-liners, hooks for any post that carries a link. Complements three_second_win (which is result-only); this is explicit benefit language.',
 'Mudahnya Jual Produk Kurang 7 Saat Teknik #2: identify one "peluru manfaat" and serve it in under nine words. The 3-second attention window cannot parse a clause; a short numeric claim is what sticks.',
 'Keringkan tangan dalam 10 saat.',
 'Produk ini mempunyai teknologi pengeringan tangan yang sangat cekap dan berkesan.',
 '{one_liner,honest_review}','{deadpan,minimal,gaul}','{1,2}','{}',
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Classic Malay copywriting%'),2,'approved'),

('pain_dream_bridge','Pain → Dream → Bridge','structure',
 'Open with one line describing the reader''s current pain, one line describing how the day would look without it, then reveal the thing that gets them from one to the other.',
 'Direct-sell posts (sell_intensity 2), utility-angle posts where the payoff is concrete.',
 'Kopi Writing / Teknik Mudah Ayat Jualan: the classic AIDA-derived structure adapted for Malay. The 30-point playbook''s questions 1-3 map exactly to pain→benefits→who-else-it-helped. We compress this to three lines so it fits in a Threads post.',
 'Tangan melekit minyak tiap kali lepas goreng.\\nCuci pinggan tak perlu gosok satu-satu.\\nSpan ni je tukar.',
 'Kami ada produk span cuci pinggan yang sangat berkualiti.',
 '{pov,flash_story,before_after}','{warm_sibling,gaul,deadpan}','{1,2}','{}',
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Classic Malay copywriting%'),3,'approved'),

('specific_dream','Name a specific mundane after-state','psychology',
 'Instead of "senang" or "jimat masa", name the exact 10-second moment the reader gets back — what they do, where they stand, what they see.',
 'Any post promising a benefit. Pairs with benefit_not_feature.',
 '30-point copywriting: buyers buy a changed day, not a product. "Jimat 10 minit" is abstract; "sempat bancuh teh sementara periuk rendam" is a moment the reader can imagine and want.',
 'Lepas goreng, boleh terus duduk makan — tak perlu gosok kuali.',
 'Menjimatkan masa anda semasa memasak.',
 '{pov,diary,confession}','{gaul,warm_sibling,deadpan}','{1,2}','{}',
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Classic Malay copywriting%'),2,'approved'),

('objection_preempt_line3','Answer the silent objection by line 3','structure',
 'By the third line, address one specific objection the reader is already thinking (too expensive, won''t fit, penat, takut rosak). Do not wait for comments; do not answer more than one per post.',
 'Direct-sell and honest-review posts (sell_intensity 1 or 2). Complements the existing general objection_preempt by tightening where in the post the objection lands.',
 '30-point questions 21–24 are all refund/warranty/fit anxieties; Kurang 7 Saat shows that unaddressed objections kill the sale in the first 3 seconds even when the hook is good. Answering one objection early reads as honesty rather than defensiveness. Line 3 (not line 1, not the end) is what the 2026 playbooks converge on — too early reads defensive, too late and the reader has already scrolled past.',
 'RM39. Mahal bagi span, tapi empat bulan saya guna tak buruk lagi.',
 'Harga RM39 sahaja, sangat berpatutan dan berbaloi.',
 '{honest_review,utility,diary}','{deadpan,minimal,warm_sibling}','{1,2}','{}',
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Classic Malay copywriting%'),2,'approved')

) AS v(code,name,type,instruction,when_to_use,mechanism,example_do,example_dont,
       compatible_formats,compatible_tones,compatible_intensity,compatible_media,
       contested,contested_note,source_id,corroboration,review_state)
ON CONFLICT (code) DO NOTHING;

-- ── New banned phrases from the 2026 + classic BM books.
-- These are distinct from the existing seed list; they specifically target patterns the
-- 2026 Threads algorithm classifies as ads and the ones the old Malay books teach that
-- look the most robotic on a 2026 text feed.
INSERT INTO banned_phrases (pattern, reason, scope) VALUES
-- 2026 anti-patterns (Threads Profit Killer + Content Machine Playbook)
('^\\s*(Hai (semua|korang|kawan)|Assalammualaikum (semua|warga)|Hello (guys|korang|semua))\\b',
 'broadcast greeting; opener must target one person, not everyone', 'persona_opener'),
('\\y(game.?changer|wajib ada|must have|berbaloi sangat|power gila|padu gila|the best)\\y',
 'empty praise phrase from Book library — banned at persona level for sounding generic', 'all'),
('\\y(konten|content creator|viral|algorithm|reach|engagement)\\b',
 'creator-economy jargon — normal Malaysians don''t talk like this', 'all'),
('\\y(jangan lepaskan|stok terhad|limited|cepat sebelum|promosi hebat|offered harga)\\y',
 'artificial urgency, flagged by Threads in 2026', 'all'),
('\\y(DM saya|PM saya|inbox saya|wasap saya|whatsapp saya|klik link (sekarang|dibawah|di bio))\\y',
 'off-platform CTA (L4 reply loop handles legitimate questions)', 'all'),
-- Classic Malay book hard-sell (newly identified from Kopi Writing / AJMP / Kurang 7 Saat)
('\\y(RAHSIA|TERBONGKAR|AJAIB|TERBAIK DI DUNIA|SANGAT HEBAT|LUAR BIASA)\\y',
 '2015-magic-word spam; tighter list than the existing no_magic_words', 'all'),
('\\y(saya nak berkongsi|hari ini saya nak|saya ingin berkongsi)\\b',
 '"sharing" opener that immediately marks the post as a pitch', 'opener'),
('^\\s*(Adakah anda|Tahukah anda|Kor(ang)? tahu( tak)?(kah)?)\\b',
 '2015-FB-ad question opener; fastest way to look like a template', 'opener'),
('\\y(harga (istimewa|promosi|terbaik)|tawaran (terhad|istimewa)|slalu RM\\d+ sekarang RM)\\y',
 'price-discount framing that reads as a katalog', 'all')
ON CONFLICT (pattern, scope) DO NOTHING;

-- ── Add new lever VALUES for persona and 2026-style micro-formats. We add these as enabled
-- levers so the bandit can rotate through them; they were missing from the original Malay
-- lever seed because the 2026 books use them heavily.
--
-- These are added with ON CONFLICT DO NOTHING so they won''t duplicate on re-run.
INSERT INTO levers (kind, code, label, brief, enabled) VALUES
('format','rant_bite','Rencana gigit','Satu luahan 1-2 baris yang paling pendek, biasanya satu keluhan atau pemerhatian dengan tarikan nafas.', true),
('format','petua','Satu petua','Satu ayat yang memberitahu satu petua kecil tanpa intro, tanpa nama produk.', true),
('angle','anti_tips','Anti-petua','Buka dengan mengatakan petua orang lain salah, kemudian tunjuk cara yang sebenar bekerja.', true),
('angle','mundane','Benda biasa','Sudut pandang yang meraikan benda yang sangat kecil dan biasa — tiada pengajaran, cuma perhatian.', true),
('tone','makcik','Makcik bawang','Nada makcik tepi pagar — panjang lebar, berleter sedikit, banyak detail yang tak penting tapi lucu.', true)
ON CONFLICT (kind, code) DO NOTHING;

-- ── Update the settings.warmup row (if present) to note the new persona-post lever/formats
-- are usable. No structural change; just a marker.
UPDATE settings
SET value = jsonb_set(
              jsonb_set(value, '{persona_extra_formats}', to_jsonb(ARRAY['rant_bite','petua']::text[]), true),
              '{persona_extra_tones}', to_jsonb(ARRAY['makcik']::text[]), true)
WHERE key = 'warmup';

-- ── Log it (run_log has no natural key; just INSERT. Duplicate log lines on re-run are harmless.)
INSERT INTO run_log (workflow, level, message, meta)
VALUES ('migration', 'info', 'seed_techniques_2026_threads applied',
        jsonb_build_object('new_source_buckets', 2, 'new_techniques', 11, 'new_banned_phrases', 9, 'new_levers', 5));
