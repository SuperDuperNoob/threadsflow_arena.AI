-- TECHNIQUES MINED FROM NEW English psychology & communication books (2026-07-31)
-- Influence (Cialdini), Never Split the Difference (Voss), Digital Body Language (Dhawan),
-- Everybody Writes (Handley), How to Win Friends Digital Age (Carnegie), Art of Community (Bacon)
--
-- Editorial rules: extract MECHANISMS for persona warm-up and conversational engagement,
-- reject manipulative surface tactics, add harmful patterns to banned_phrases.
-- These books teach PRINCIPLES, not templates. The persona layer uses them as guardrails.
--
-- Run ON TOP of seed_techniques_2026_threads.sql. ON CONFLICT DO NOTHING.

-- ── Source: register the psychology/communication theory bucket
INSERT INTO technique_sources (title, author, notes) VALUES
('Books/ (Psychology & communication theory — Cialdini, Voss, Dhawan, Handley, Carnegie, Bacon)', 
 'Robert Cialdini, Chris Voss, Erica Dhawan, Ann Handley, Dale Carnegie Associates, Jono Bacon',
 'English-language psychology and communication books. Mechanisms extracted: reciprocity loops, tactical empathy, digital tone signals, conversational writing, community participation. Manipulative tactics (artificial scarcity, false urgency, manufactured social proof) rejected as banned phrases.')
ON CONFLICT (title) DO NOTHING;

-- ── Techniques for persona warm-up and engagement
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
-- FROM: Influence (Cialdini) — reciprocity, liking, social proof (used carefully)
-- ══════════════════════════════════════════════════════════════════════════════

('reciprocity_first','Give before you ask','psychology',
 'In persona posts (sell_intensity 0), offer one genuinely useful tip, observation, or small story with zero mention of products. Build a bank of goodwill before any sell post.',
 'All persona/warm-up posts. This is the psychological foundation of the zero_sell_ratio rule.',
 'Cialdini reciprocity principle: humans feel obligated to return favors. A post that gives real value (a petua, a relatable moment, a useful observation) creates a psychological debt that makes the next sell post feel like a friend''s recommendation rather than an ad. This is why accounts that only sell get throttled — they have no reciprocity bank.',
 'Dapur kecil, tapi kalau susun periuk ikut saiz, boleh muat semua. Petua mak saya.',
 'Hari ini saya nak share satu produk yang sangat bagus untuk dapur kecil.',
 '{petua,rant_bite,diary,overheard}'::text[],'{warm_sibling,gaul,deadpan}'::text[],'{0}'::smallint[],'{}'::text[],
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Psychology%'),3,'approved'),

('liking_through_specificity','Liking through specific shared experience','psychology',
 'Name one very specific mundane detail that signals "I am like you" — a place, a time, a small struggle. Never say "sama macam saya" or "kita semua".',
 'Persona posts and confession formats. This is the mechanism behind niche_positioning but applied at the sentence level.',
 'Cialdini liking principle: we buy from people we like, and we like people who are like us. But on Threads, saying "we''re all the same" reads as a broadcast. Naming one specific detail (e.g., "flat Ampang", "bas rapidKL", "petronas RON95") signals shared experience without claiming it. The reader self-identifies.',
 'Flat Ampang, parking selalu penuh. Kena balik sebelum 6 kalau nak dapat slot.',
 'Kita semua tahu parking kat KL ni susah kan?',
 '{pov,confession,diary,overheard}'::text[],'{gaul,warm_sibling}'::text[],'{0,1}'::smallint[],'{}'::text[],
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Psychology%'),2,'approved'),

('social_proof_subtle','Subtle social proof: "ramai tanya" not "ramai beli"','psychology',
 'When referencing other people, frame it as questions they asked or problems they shared, never as purchase counts or testimonials.',
 'Honest reviews and reply-marketing contexts. Complements sold_count_proof but safer for warm-up phase.',
 'Cialdini social proof: we look to others to decide what''s correct. But "1000 orang dah beli" is the oldest trick in the book and reads as an ad. "Ramai tanya kat mana beli" or "member saya pun ada masalah yang sama" frames social proof as organic conversation, not a sales funnel.',
 'Ramai member tanya, memang berkesan ke span ni? Saya guna 4 bulan, masih elok.',
 'Sudah lebih 1000 pelanggan berpuas hati dengan produk ini.',
 '{honest_review,utility,confession}'::text[],'{warm_sibling,gaul,deadpan}'::text[],'{1,2}'::smallint[],'{}'::text[],
 true,'Contra sold_count_proof which uses explicit numbers. This version is softer and works better in warm-up phase. Bandit decides which wins.',
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Psychology%'),2,'approved'),

('unity_shared_identity','Unity: name the shared identity, not the product','psychology',
 'Open by naming the group the reader belongs to (ibu bekerja, fresh grad, anak rantau) before any mention of what you''re talking about.',
 'POV and confession posts. This is the mechanism behind niche_positioning but framed as identity rather than problem.',
 'Cialdini unity principle (added in the expanded edition): we are influenced most by people we perceive as "one of us". Naming the shared identity first ("ibu yang kerja shift", "student UITM Shah Alam") creates in-group signaling before the post even gets to its point. The reader thinks "ini orang macam aku".',
 'Ibu kerja shift, balik rumah penat, dapur bersepah. Ni cara saya kemas 5 minit je.',
 'Produk ini sesuai untuk ibu-ibu yang sibuk dengan kerja dan rumah.',
 '{pov,confession,diary}'::text[],'{warm_sibling,gaul}'::text[],'{0,1}'::smallint[],'{}'::text[],
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Psychology%'),2,'approved'),

-- ══════════════════════════════════════════════════════════════════════════════
-- FROM: Never Split the Difference (Voss) — tactical empathy, mirroring, labeling
-- ══════════════════════════════════════════════════════════════════════════════

('tactical_empathy_label','Label the emotion, don''t feel it','psychology',
 'In replies (L4 reply loop), acknowledge the commenter''s emotion with "macam [frustrated/excited/confused] je" or "faham sangat" before answering their question.',
 'Reply-marketing and L4 engagement. This is how you turn a transactional reply into a conversation.',
 'Chris Voss tactical empathy: you don''t need to agree with someone to show you understand their emotional state. Labeling it ("macam stress je", "nampak excited ni") makes them feel heard, which triggers reciprocity and makes them more likely to click your link or ask a follow-up. This is why "terima kasih" replies kill engagement.',
 'Comment: "Mahalnya!" Reply: "Faham, RM39 memang nampak mahal untuk span. Tapi 4 bulan guna, jimat dah."',
 'Comment: "Mahalnya!" Reply: "Harga RM39 sahaja, sangat berpatutan."',
 '{}'::text[],'{warm_sibling,gaul}'::text[],'{1,2}'::smallint[],'{}'::text[],
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Psychology%'),3,'approved'),

('mirror_last_three','Mirror: repeat their last 1-3 words as a question','psychology',
 'In replies, when someone asks a question or makes a statement, repeat their last 1-3 words back as a question (with "?" or upward tone) to invite them to elaborate.',
 'Reply-marketing and L4 engagement. This is the single highest-ROI reply technique for triggering conversation.',
 'Chris Voss mirroring: repeating the last few words as a question signals you''re listening and invites the other person to elaborate. It feels like active listening but actually gives you time to think and makes them feel heard. On Threads, this turns a dead-end comment ("Beli kat mana?") into a conversation ("Kat mana? Shopee ke Lazada?") which boosts reply density and algorithm distribution.',
 'Comment: "Memang berkesan ke?" Reply: "Berkesan ke? Saya guna 4 bulan, still elok lagi."',
 'Comment: "Memang berkesan ke?" Reply: "Ya, sangat berkesan."',
 '{}'::text[],'{gaul,warm_sibling}'::text[],'{1,2}'::smallint[],'{}'::text[],
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Psychology%'),3,'approved'),

('calibrated_question','Ask "macam mana" not "kenapa"','psychology',
 'In replies, ask calibrated questions that invite the commenter to share their context: "macam mana kau guna?", "berapa lama dah cari?", "untuk apa?".',
 'Reply-marketing. This is how you turn a one-line comment into a thread that boosts distribution.',
 'Chris Voss calibrated questions: "why" questions feel accusatory ("kenapa tanya?"). "How" and "what" questions ("macam mana", "untuk apa") feel like genuine curiosity and give the other person control. On Threads, this creates longer comment threads which the algorithm interprets as high engagement, pushing the post to more people.',
 'Comment: "Nak beli satu." Reply: "Untuk dapur ke bilik air? Sebab ada dua saiz."',
 'Comment: "Nak beli satu." Reply: "Link kat bio ya."',
 '{}'::text[],'{warm_sibling,gaul}'::text[],'{1,2}'::smallint[],'{}'::text[],
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Psychology%'),2,'approved'),

('late_night_dj_voice','Late-night FM DJ voice: calm, slow, downward','voice',
 'In sell posts (intensity 1-2), use short declarative sentences with periods, not exclamation marks. State facts plainly. No hype, no "!", no "memang terbaik!".',
 'Honest reviews and direct-sell posts. This is the tone that reads as trustworthy rather than salesy.',
 'Chris Voss late-night FM DJ voice: slow, calm, downward-inflecting speech signals "I''m in control, this isn''t up for debate". On Threads, this translates to short sentences with periods, no exclamation marks, no "memang berbaloi!" hype. It reads as someone stating facts, not selling. The opposite (exclamation marks, hype words) is what gets you flagged as an ad.',
 'RM39. 4 bulan guna. Tak melekit lagi.',
 'RM39 sahaja! Memang berbaloi sangat! Beli sekarang!',
 '{one_liner,honest_review,before_after}'::text[],'{deadpan,minimal}'::text[],'{1,2}'::smallint[],'{}'::text[],
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Psychology%'),3,'approved'),

-- ══════════════════════════════════════════════════════════════════════════════
-- FROM: Digital Body Language (Dhawan) — punctuation, response time, clarity
-- ══════════════════════════════════════════════════════════════════════════════

('punctuation_signals_tone','Punctuation is tone: period = serious, no period = casual','voice',
 'Use periods for serious/factual posts (sell_intensity 1-2). Drop periods for casual/persona posts (intensity 0). Never use exclamation marks except in direct quotes.',
 'All posts. This is a subtle but powerful signal that separates "friend talking" from "brand posting".',
 'Erica Dhawan digital body language: in text-based communication, punctuation replaces facial expressions. A period signals "this is a statement, not up for debate" (good for sell posts). No period signals "casual thought" (good for persona posts). Exclamation marks signal "I''m trying too hard" and are the fastest way to look like a brand account. On Threads, this is the difference between "RM39. 4 bulan guna." (trustworthy) and "RM39! 4 bulan guna!" (ad).',
 'Persona: Dapur kecil tapi boleh muat semua kalau susun betul',
 'Persona: Dapur kecil tapi boleh muat semua kalau susun betul!',
 '{}'::text[],'{}'::text[],'{0,1,2}'::smallint[],'{}'::text[],
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Psychology%'),2,'approved'),

('clarity_over_cleverness','Clarity over cleverness: one idea per sentence','structure',
 'Each sentence should contain exactly one idea. If a sentence has two clauses joined by "dan" or "tapi", split it into two sentences.',
 'All posts. This is the most-repeated rule across all the communication books.',
 'Erica Dhawan: confusing messages create anxiety and make people disengage. Ann Handley: one idea per sentence is the foundation of readable writing. On Threads, where attention spans are 3 seconds, a sentence with two ideas forces the reader to choose which one to process — and they usually choose "scroll past". Short, single-idea sentences are what stop the scroll.',
 'Buka peti ais, bau hanyir. Rupanya lobak merah terperuk di belakang.',
 'Buka peti ais dan terbau hanyir sebab ada lobak merah yang terperuk di belakang sejak minggu lepas.',
 '{}'::text[],'{}'::text[],'{0,1,2}'::smallint[],'{}'::text[],
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Psychology%'),3,'approved'),

-- ══════════════════════════════════════════════════════════════════════════════
-- FROM: Everybody Writes (Handley) — conversational writing, cutting ruthlessly
-- ══════════════════════════════════════════════════════════════════════════════

('write_like_you_talk','Write like you talk to a friend, not like you''re writing an essay','voice',
 'Use BM pasar contractions ("tak" not "tidak", "nak" not "hendak", "kat" not "di"). Use sentence fragments. Start sentences with "Dan" or "Tapi" if that''s how you''d say it.',
 'All posts except utility/how-to. This is what separates "friend talking" from "brand posting".',
 'Ann Handley: writing evolves with us, and in 2026 it''s more relaxed than ever. On Threads, formal BM ("tidak", "hendak", "di mana") reads as robotic and corporate. BM pasar ("tak", "nak", "kat mana") reads as human. The books teach this explicitly: if you wouldn''t say it to a friend at a mamak, don''t write it in a post.',
 'Tak sangka RM15 boleh kemaskan meja.',
 'Tidak sangka bahawa RM15 sahaja boleh mengemaskan meja saya.',
 '{}'::text[],'{gaul,warm_sibling,chaotic}'::text[],'{0,1}'::smallint[],'{}'::text[],
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Psychology%'),3,'approved'),

('cut_ruthlessly','Cut ruthlessly: if a sentence doesn''t earn its place, delete it','structure',
 'After drafting, delete any sentence that doesn''t either (a) introduce a new idea, (b) provide a specific detail, or (c) create emotional resonance. "Sangat bagus" and "memang berbaloi" earn nothing.',
 'All posts. This is the editing pass that separates good posts from mediocre ones.',
 'Ann Handley: every sentence should earn its place. On Threads, where you have 180 chars before the "see more" cutoff, wasted words are fatal. "Produk ini sangat bagus" earns nothing because it''s a claim without evidence. "RM39, 4 bulan guna" earns its place because it''s specific. The editing pass is: for each sentence, ask "does this give the reader something they didn''t have before?" If no, delete.',
 'RM39. 4 bulan. Tak melekit lagi.',
 'Produk ini sangat bagus dan berkualiti tinggi. Memang berbaloi untuk dimiliki.',
 '{}'::text[],'{}'::text[],'{0,1,2}'::smallint[],'{}'::text[],
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Psychology%'),2,'approved'),

-- ══════════════════════════════════════════════════════════════════════════════
-- FROM: How to Win Friends Digital Age (Carnegie) — bury boomerangs, listen longer
-- ══════════════════════════════════════════════════════════════════════════════

('bury_boomerangs','Bury your boomerangs: don''t make it about you','psychology',
 'In replies, don''t immediately pivot back to your product or your experience. Answer their question fully, then ask about their context. Save your story for when they ask.',
 'Reply-marketing and L4 engagement. This is what separates conversation from broadcasting.',
 'Carnegie "bury your boomerangs": a boomerang is when someone shares something and you immediately pivot back to yourself ("Oh you have that problem? Let me tell you about MY product"). On Threads, this kills engagement because it signals you''re not listening, you''re just waiting to sell. The fix: answer their question, ask about their context, and only share your experience if they ask. This turns a comment into a conversation.',
 'Comment: "Memang berkesan ke?" Reply: "Untuk apa? Dapur ke bilik air? Sebab ada dua jenis."',
 'Comment: "Memang berkesan ke?" Reply: "Memang berkesan! Saya guna 4 bulan, jimat sangat."',
 '{}'::text[],'{warm_sibling,gaul}'::text[],'{1,2}'::smallint[],'{}'::text[],
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Psychology%'),2,'approved'),

('listen_longer','Listen longer: ask 2 questions before sharing your take','psychology',
 'In reply threads, ask at least 2 follow-up questions before sharing your own opinion or experience. This signals you''re listening, not broadcasting.',
 'Reply-marketing. This is the mechanism that turns a one-line comment into a thread that boosts distribution.',
 'Carnegie "listen longer": most people are waiting to talk, not listening. On Threads, this manifests as replies that immediately pivot to "saya pun sama" or "saya guna ni". The fix: ask 2 questions ("Untuk apa?", "Berapa lama dah cari?") before sharing your take. This signals genuine interest and creates longer threads, which the algorithm rewards.',
 'Comment: "Nak cari yang murah." Reply: "Untuk apa guna? Dapur ke bilik air? Berapa lama dah cari?"',
 'Comment: "Nak cari yang murah." Reply: "Saya guna yang ni, RM39 je, memang berbaloi."',
 '{}'::text[],'{warm_sibling,gaul}'::text[],'{1,2}'::smallint[],'{}'::text[],
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Psychology%'),2,'approved'),

('leave_better','Leave others a little better: one useful detail in every reply','psychology',
 'Every reply should contain at least one specific useful detail the commenter didn''t have before: a timing, a comparison, a warning, a tip.',
 'Reply-marketing and L4 engagement. This is what makes people click your profile and follow you.',
 'Carnegie "leave others a little better": every interaction should give the other person something they didn''t have. On Threads, a reply that just says "terima kasih" or "link kat bio" gives nothing. A reply that says "Shopee, tapi tunggu sale hari gaji, lagi murah" gives a useful timing tip. This is what turns a commenter into a follower.',
 'Comment: "Beli kat mana?" Reply: "Shopee, tapi tunggu sale hari gaji, boleh jimat RM5-10."',
 'Comment: "Beli kat mana?" Reply: "Shopee. Link kat bio."',
 '{}'::text[],'{warm_sibling,gaul,deadpan}'::text[],'{1,2}'::smallint[],'{}'::text[],
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Psychology%'),3,'approved'),

-- ══════════════════════════════════════════════════════════════════════════════
-- FROM: Art of Community (Bacon) — participation loops, belonging signals
-- ══════════════════════════════════════════════════════════════════════════════

('participation_loop','Ask for input, not just attention','psychology',
 'In persona posts, ask for one specific piece of input: "korang guna yang mana?", "ada petua lain?", "tempat korang macam ni juga ke?". Never ask "macam mana?" (too broad).',
 'Persona posts (sell_intensity 0). This is how you build a community that replies, which boosts distribution.',
 'Jono Bacon participation loops: communities thrive when members have a role. On Threads, asking "macam mana pendapat korang?" is too broad — people don''t know what to say. Asking "korang guna yang mana?" or "tempat korang macam ni juga ke?" gives them a specific prompt to respond to. This creates reply density, which the algorithm rewards.',
 'Dapur kecil, saya susun periuk ikut saiz. Korang susun macam mana?',
 'Macam mana pendapat korang tentang cara susun periuk?',
 '{petua,rant_bite,diary}'::text[],'{gaul,warm_sibling}'::text[],'{0}'::smallint[],'{}'::text[],
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Psychology%'),2,'approved'),

('belonging_signal','Signal belonging: use "kita" not "saya" when sharing struggles','psychology',
 'When sharing a struggle or complaint, use "kita" (we inclusive) instead of "saya" (I) to signal shared experience. But when sharing a win or tip, use "saya" to avoid sounding preachy.',
 'Persona posts, rant_bite and confession formats. This is the subtle mechanism behind unity_shared_identity.',
 'Jono Bacon belonging signals: communities form around shared identity. On Threads, using "kita" when complaining ("kita semua tahu parking KL susah") signals "I''m one of you, we share this struggle". But using "kita" when giving tips ("kita semua patut susun periuk macam ni") sounds preachy. The rule: "kita" for struggles, "saya" for wins and tips.',
 'Kita semua tahu, balik kerja penat, dapur bersepah. Ni cara saya kemas 5 minit.',
 'Kita semua patut susun periuk ikut saiz, lagi kemas.',
 '{rant_bite,confession,diary}'::text[],'{warm_sibling,gaul}'::text[],'{0,1}'::smallint[],'{}'::text[],
 true,'Contra niche_positioning which uses very specific person-targeting. This uses inclusive language. Bandit decides which works better in different contexts.',
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Psychology%'),2,'approved')

) AS v(code,name,type,instruction,when_to_use,mechanism,example_do,example_dont,
       compatible_formats,compatible_tones,compatible_intensity,compatible_media,
       contested,contested_note,source_id,corroboration,review_state)
ON CONFLICT (code) DO NOTHING;

-- ── New banned phrases from psychology books — manipulative tactics that look like the principles above
-- but are actually the harmful surface versions that get you flagged as an ad.
INSERT INTO banned_phrases (pattern, reason, scope) VALUES
-- Artificial scarcity / false urgency (Cialdini warns against this in the expanded edition)
('\\y(stok (terhad|tinggal \\d+|nak habis)|last (chance|unit|stock)|sempat lagi|cepat sebelum)\\y',
 'artificial scarcity — Cialdini warns this is the most-abused principle and reads as an ad', 'all'),
-- Manufactured social proof (the harmful version of social_proof_subtle)
('\\y(\\d+ (ribu|ratus)? (orang|pelanggan|customer) dah (beli|guna|cuba)|testimoni (dari|pelanggan)|review (dari|pelanggan))\\y',
 'manufactured social proof — the harmful version of "ramai tanya". Real social proof is conversational, not numerical.', 'all'),
-- False authority signals
('\\y(pakar|expert|certified|guaranteed|diiktiraf|terbukti secara saintifik|kajian menunjukkan)\\y',
 'false authority — unless you actually are a certified expert in the domain, this reads as a scam', 'all'),
-- Manipulative reciprocity triggers
('\\y(saya (nak|mau) bagi (percuma|free)|ambil percuma|download free|claim sekarang)\\y',
 'manipulative reciprocity — offering "free" things to trigger obligation is the oldest scam on the internet', 'all'),
-- Aggressive mirroring / parroting (the harmful version of mirror_last_three)
('\\y(saya faham sangat (masalah|keadaan|situasi) (anda|korang|kau)|saya tahu (anda|korang|kau) rasa)\\y',
 'aggressive empathy — sounds like a script, not a friend. Real empathy is specific, not templated.', 'all')
ON CONFLICT (pattern, scope) DO NOTHING;

-- ── Log it
INSERT INTO run_log (workflow, level, message, meta)
VALUES ('migration', 'info', 'seed_techniques_psychology applied',
        jsonb_build_object('new_source_buckets', 1, 'new_techniques', 17, 'new_banned_phrases', 5));
