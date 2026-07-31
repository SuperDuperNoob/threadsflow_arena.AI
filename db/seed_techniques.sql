-- COLD-START TECHNIQUE LIBRARY
-- The system is fully functional with ZERO PDFs uploaded. This file seeds 42 techniques
-- that are already validated against the same rules the PDF miner enforces.
--
-- Uploading PDFs later only ADDS to this and bumps `corroboration` where a book agrees.
-- Nothing here depends on NotebookLM, Apify, or any external service.
--
-- Run after schema_techniques.sql and schema_kb.sql.

INSERT INTO technique_sources (id, title, author, notes)
VALUES (1, 'ThreadsFlow baseline', 'built-in',
        'Hand-written cold-start library. Survives with zero uploaded documents.')
ON CONFLICT (title) DO NOTHING;
SELECT setval(pg_get_serial_sequence('technique_sources','id'),
              GREATEST((SELECT max(id) FROM technique_sources), 1));

INSERT INTO techniques
  (code, name, type, instruction, when_to_use, mechanism, example_do, example_dont,
   compatible_formats, compatible_tones, compatible_intensity, contested, contested_note,
   source_id, corroboration, review_state)
VALUES

-- ══════════════════════════ HOOKS (12) — the first 3 seconds
('sensory_open','Sensory opening','hook',
 'Name a physical sensation the reader felt in the last 7 days before naming any product category.',
 'Cold audience that has no reason to care yet.',
 'Recognition fires faster than persuasion; the reader confirms before they evaluate.',
 'Tangan licin pas ngangkat panci, jam setengah 7 pagi, udah telat.',
 'Pernah ngerasain tangan licin waktu masak? Produk ini solusinya.',
 '{}','{deadpan,gaul,warm_sibling,chaotic,minimal}','{0,1}',false,null,1,1,'approved'),

('exact_time_open','Exact time opening','hook',
 'Open by stating the exact clock time the situation happened.',
 'Any story-shaped post.','A specific timestamp reads as memory, not as marketing.',
 'Jam 23.40, masih nyari colokan di kamar kos.',
 'Suatu malam saya kesulitan mencari colokan.',
 '{flash_story,confession,diary,pov,overheard}','{}','{0,1,2}',false,null,1,1,'approved'),

('mid_action_open','Start mid-action','hook',
 'Begin the first sentence in the middle of an action already in progress, with no setup.',
 'Short formats where setup would eat the whole post.',
 'Missing context creates a gap the reader fills by continuing.',
 'Udah tiga kali balik lagi ke rak yang sama.',
 'Waktu saya sedang berbelanja di supermarket, saya kembali ke rak yang sama tiga kali.',
 '{flash_story,one_liner,pov,chat_narration}','{}','{0,1}',false,null,1,1,'approved'),

('overheard_line_open','Open on someone else''s words','hook',
 'Open with a short line another person said, before explaining who said it.',
 'When you want distance from the sell.','Quoted speech is heard as evidence, not as a claim.',
 '"Beli yang murah aja, nanti juga rusak." Kata bapak saya, 2019.',
 'Ayah saya pernah berkata bahwa kita sebaiknya membeli barang murah.',
 '{overheard,chat_narration,confession,myth_bust}','{}','{0,1}',false,null,1,1,'approved'),

('number_first_open','Lead with a raw number','hook',
 'Make the first thing in the post a number with its unit, before any sentence.',
 'Utility and price-driven posts.','A bare number is unusual enough in a feed to stop a thumb.',
 '11 cm. Itu panjang gagangnya, dan itu masalahnya.',
 'Gagangnya cukup pendek, hanya sekitar 11 cm saja.',
 '{list_of_three,one_liner,honest_review,before_after}','{deadpan,minimal}','{1,2}',false,null,1,1,'approved'),

('wrong_assumption_open','Open on a wrong assumption','hook',
 'State something the reader probably believes as if it were true, then contradict it in the next sentence.',
 'Crowded categories where everyone says the same thing.',
 'Contradiction of a held belief demands resolution.',
 'Katanya makin mahal makin awet. Punya saya yang 89rb udah 8 bulan.',
 'Banyak orang mengira barang mahal pasti lebih awet, padahal belum tentu.',
 '{myth_bust,honest_review,one_liner}','{deadpan,gaul,warm_sibling}','{1,2}',false,null,1,1,'approved'),

('unfinished_open','Open with an unfinished thought','hook',
 'Write a first line that is grammatically incomplete and resolve it in the second line.',
 'Micro-length posts.','An open syntactic loop is uncomfortable to abandon.',
 'Tiga bulan nunda beli ini gara-gara.\nGara-gara mikir 89rb itu mahal.',
 'Saya menunda membeli ini selama tiga bulan karena harganya.',
 '{one_liner,confession,flash_story}','{chaotic,gaul,deadpan}','{0,1}',false,null,1,1,'approved'),

('name_the_person_open','Name a specific person','hook',
 'Open by naming a specific role-person in your life rather than a generic group.',
 'Identity and social-proof angles.','A named individual is concrete; an audience is abstract.',
 'Adik saya yang kosannya 3x3 meter akhirnya nyerah.',
 'Banyak anak kos dengan kamar sempit mengalami masalah ini.',
 '{flash_story,pov,chat_narration,confession}','{warm_sibling,gaul,deadpan}','{0,1}',false,null,1,1,'approved'),

('cost_comparison_open','Open on an unrelated cost','hook',
 'Open by naming a routine everyday expense, then place the product price against it.',
 'Price-shock angle only.','Reframing anchors the price against something already accepted.',
 'Kopi kemarin 32rb. Ini 89rb dan kepakai tiap hari sejak Maret.',
 'Harganya sangat terjangkau, hanya 89 ribu saja.',
 '{one_liner,list_of_three,honest_review}','{deadpan,minimal,gaul}','{1,2}',false,null,1,1,'approved'),

('refusal_open','Open by refusing','hook',
 'Open by stating who should not buy this, using a specific disqualifying condition.',
 'Direct-sell posts where trust is the bottleneck.',
 'Exclusion signals honesty and raises perceived selectivity.',
 'Kalau dapur kamu udah ada yang begini, gausah. Serius.',
 'Produk ini cocok untuk semua orang yang suka memasak.',
 '{honest_review,myth_bust,confession}','{deadpan,minimal}','{1,2}',false,null,1,1,'approved'),

('counting_open','Open with a running count','hook',
 'Open by stating how many times something has happened, using an exact count.',
 'Diary and repetition formats.','A tally implies duration and real use.',
 'Ketujuh kalinya saya cuci ini. Warnanya belum luntur.',
 'Sudah beberapa kali dicuci dan warnanya masih bagus.',
 '{diary,honest_review,before_after}','{}','{1}',false,null,1,1,'approved'),

('object_first_open','Open on the object, not the person','hook',
 'Make a physical object the grammatical subject of the first sentence.',
 'Minimal and deadpan tones.','Removing the narrator removes the salesperson.',
 'Gagang plastiknya meleleh dikit di sisi kanan.',
 'Saya menemukan bahwa gagang plastiknya sedikit meleleh.',
 '{honest_review,diary,one_liner}','{deadpan,minimal}','{0,1}',false,null,1,1,'approved'),

-- ══════════════════════════ PROOF (7) — the antidote to generic AI copy
('flaw_first','Flaw before benefit','proof',
 'State one measurable drawback using a real number before mentioning any benefit.',
 'Skeptical audiences and any direct-sell post.',
 'A volunteered concession buys credibility for everything that follows.',
 'Gagangnya 11 cm, kependekan buat tangan gede. Tapi 90 detik udah panas rata.',
 'Produk ini hampir sempurna, hanya ada sedikit kekurangan kecil.',
 '{honest_review,myth_bust,confession,before_after}','{deadpan,minimal,warm_sibling,gaul}','{1,2}',false,null,1,1,'approved'),

('odd_number_proof','Odd numbers over round','proof',
 'Quote a non-round measured number instead of a rounded estimate for any result.',
 'Whenever you state a result.','Round numbers read as estimates; odd numbers read as measurements.',
 'Panas dalam 93 detik di kompor saya.',
 'Panas dalam waktu sekitar 2 menit.',
 '{}','{}','{1,2}',false,null,1,1,'approved'),

('duration_proof','Elapsed-time proof','proof',
 'State how long you have owned the item in weeks or months instead of describing durability.',
 'Any claim about quality lasting.','Duration is checkable; "durable" is not.',
 'Dipakai tiap hari sejak Maret. Belum ada yang copot.',
 'Kualitasnya sangat awet dan tahan lama.',
 '{diary,honest_review,before_after}','{}','{1,2}',false,null,1,1,'approved'),

('real_review_paraphrase','Paraphrase a real review','proof',
 'Paraphrase one actual buyer review in that buyer''s own register, never inventing a new one.',
 'Social-proof angle.','Borrowed specificity you could not have invented yourself.',
 'Ada yang nulis di review: "berisik dikit tapi kenceng". Setuju sih.',
 'Banyak pembeli mengatakan bahwa produk ini sangat memuaskan.',
 '{honest_review,overheard,myth_bust}','{}','{1,2}',false,null,1,1,'approved'),

('failure_case_proof','Name where it failed','proof',
 'Describe one specific situation where the product did not work well.',
 'High-trust posts and expensive-feeling categories.',
 'A stated boundary makes the working cases believable.',
 'Buat wajan yang gagangnya bulat, ini gak nyangkut. Yang pipih aman.',
 'Cocok digunakan untuk berbagai jenis peralatan masak.',
 '{honest_review,myth_bust}','{deadpan,minimal,warm_sibling}','{1,2}',false,null,1,1,'approved'),

('sold_count_proof','Use the real sold count','proof',
 'Quote the actual sold count from the listing verbatim rather than describing popularity.',
 'Social proof when the number is genuinely large.',
 'Verifiable numbers transfer trust; adjectives do not.',
 '4.2rb terjual. Saya salah satunya, bulan lalu.',
 'Produk ini sangat laris dan banyak dibeli orang.',
 '{}','{deadpan,gaul,minimal}','{1,2}',true,
 'Works only when the number is large. Below ~200 sold, naming it reduces trust rather than building it.',
 1,1,'approved'),

('no_superlative_proof','Comparative not superlative','proof',
 'Compare against one named alternative you actually used instead of claiming it is the best.',
 'Any comparison.','A bounded comparison is checkable; a superlative is a red flag.',
 'Lebih enak dipegang daripada yang stainless punya kakak saya.',
 'Ini adalah spatula terbaik yang pernah ada.',
 '{}','{}','{1,2}',false,null,1,1,'approved'),

-- ══════════════════════════ VOICE (6)
('one_idea_sentence','One idea per sentence','voice',
 'Limit every sentence to a single idea and cut any sentence carrying two.',
 'Always.','Feeds are read at speed; compound sentences get skipped.',
 'Gagangnya pendek. Buat saya gapapa. Buat suami saya enggak.',
 'Gagangnya pendek sehingga bagi saya tidak masalah namun bagi suami saya hal itu menjadi kendala.',
 '{}','{}','{0,1,2}',false,null,1,1,'approved'),

('uneven_rhythm','Uneven sentence lengths','rhythm',
 'Place one sentence of three words or fewer next to a much longer sentence.',
 'Any post longer than 120 characters.',
 'Regular rhythm reads as written; irregular rhythm reads as spoken.',
 'Saya nunda tiga bulan gara-gara mikir 89rb itu mahal buat barang beginian. Bodoh sih.',
 'Saya menunda pembelian selama tiga bulan. Saya pikir harganya cukup mahal.',
 '{}','{}','{0,1,2}',false,null,1,1,'approved'),

('no_explaining_emotion','Show, never name the feeling','voice',
 'Delete any sentence that names an emotion and replace it with the action that caused it.',
 'Always.','Naming a feeling asks for belief; showing the cause earns it.',
 'Saya berdiri di dapur mandangin itu selama satu menit penuh.',
 'Saya merasa sangat kesal dan frustrasi dengan situasi ini.',
 '{}','{}','{0,1,2}',false,null,1,1,'approved'),

('abrupt_end','End without resolving','structure',
 'End the post on the last concrete detail without any summary or conclusion.',
 'Story-shaped posts.','A tidy ending signals a written piece; an abrupt one signals a real thought.',
 'Sekarang nyangkut di gantungan sebelah kulkas.',
 'Intinya, produk ini benar-benar mengubah cara saya memasak setiap hari.',
 '{flash_story,confession,diary,pov,overheard}','{}','{0,1}',false,null,1,1,'approved'),

('lowercase_drift','Let the register slip','voice',
 'Write at least one clause the way it would be typed in a hurry, without fixing it.',
 'Casual tones only. Never for minimal or corporate parody.',
 'Small imperfections are the strongest human signal available in text.',
 'btw yg warna item stoknya tinggal dikit td pas liat',
 'Sebagai informasi tambahan, stok untuk varian warna hitam tampaknya menipis.',
 '{confession,chat_narration,overheard}','{gaul,chaotic}','{0,1}',false,null,1,1,'approved'),

('second_person_singular','Write to one person','voice',
 'Address a single reader using singular pronouns and never address a group.',
 'Always.','Broadcast language triggers ad-recognition; direct address does not.',
 'Kalau meja kamu sempit kayak punya saya, ini muat.',
 'Bagi kalian semua yang memiliki meja berukuran kecil, produk ini sangat cocok.',
 '{}','{}','{0,1,2}',false,null,1,1,'approved'),

-- ══════════════════════════ PSYCHOLOGY (7)
('specific_persona_target','Disqualify to qualify','psychology',
 'Name a narrow group with one unusual shared condition rather than a broad demographic.',
 'Identity angle.','Narrow targeting increases response from the target more than it loses outside it.',
 'Buat yang kerja shift malem dan gabisa berisik jam 2 pagi.',
 'Cocok untuk siapa saja yang membutuhkan.',
 '{pov,confession,flash_story,list_of_three}','{}','{0,1,2}',false,null,1,1,'approved'),

('objection_preempt','Answer the doubt before it forms','psychology',
 'Name the reader''s most likely objection in your own words before making any claim.',
 'Direct-sell posts.','A stated objection cannot be used as a reason to leave.',
 'Iya, plastik. Saya juga mikir bakal jelek. Ternyata engga.',
 'Meskipun terbuat dari plastik, kualitasnya tetap sangat baik.',
 '{honest_review,myth_bust,confession}','{}','{1,2}',false,null,1,1,'approved'),

('delayed_product','Delay the product','structure',
 'Do not mention the product or its category until after the halfway point of the post.',
 'Soft-sell and zero-sell posts.','Engagement earned before the pitch survives the pitch.',
 'Tiga bulan saya nyalahin kompornya. Ternyata wajannya.',
 'Wajan ini adalah solusi terbaik untuk masalah memasak Anda.',
 '{flash_story,confession,diary,overheard,pov}','{}','{0,1}',false,null,1,1,'approved'),

('curiosity_withhold','Withhold the mechanism','psychology',
 'State the outcome plainly but leave the reason for it unstated in the post body.',
 'Curiosity-gap angle, where the comment carries the link.',
 'An unexplained result drives people to the comments, which is where your link lives.',
 'Piring numpuk berkurang setengah dan saya gak beli apa-apa yang mahal.',
 'Dengan produk ini, cucian piring Anda akan berkurang secara signifikan!',
 '{one_liner,flash_story,before_after}','{deadpan,minimal,gaul}','{0,1}',false,null,1,1,'approved'),

('cost_of_inaction','Price the delay','psychology',
 'Quantify what continuing the current behaviour costs in time or money over a stated period.',
 'Utility angle for practical products.',
 'Loss framing outperforms gain framing when the loss is already being incurred.',
 'Sepuluh menit tiap malem. Sebulan berarti 5 jam buat gosok panci.',
 'Menghemat banyak waktu Anda setiap harinya!',
 '{list_of_three,honest_review,before_after}','{deadpan,warm_sibling,minimal}','{1,2}',false,null,1,1,'approved'),

('mundane_specificity','Boring specifics','psychology',
 'Include one irrelevant, boring detail that no advertisement would ever bother to include.',
 'Always. This is the highest-value technique in the library.',
 'Irrelevant detail cannot be strategic, so the reader stops reading strategically.',
 'Sampenya hari Rabu, kurirnya nitip ke warung sebelah.',
 'Pengiriman sangat cepat dan pelayanannya memuaskan.',
 '{}','{}','{0,1,2}',false,null,1,1,'approved'),

('status_quo_defense','Defend not buying','psychology',
 'Explicitly tell the reader their current solution is probably fine.',
 'Zero and soft sell.','Removing pressure removes the reason to resist.',
 'Kalau yang sekarang masih jalan, pakai aja terus. Saya cuma cerita.',
 'Jangan sampai ketinggalan, segera miliki sekarang juga!',
 '{confession,honest_review,diary}','{deadpan,minimal,warm_sibling}','{0,1}',false,null,1,1,'approved'),

-- ══════════════════════════ STRUCTURE (4)
('three_beat_story','Three beats only','structure',
 'Structure the post as exactly three beats: ordinary situation, small turn, concrete last image.',
 'Flash story format.','Three beats is the shortest complete narrative shape.',
 'Tiap pagi buru-buru.\nKemarin coba pindahin ke laci atas.\nSekarang keluar rumah 4 menit lebih cepet.',
 'Dulu saya kesulitan, kemudian saya menemukan solusi, dan sekarang hidup saya jauh lebih baik.',
 '{flash_story,before_after,diary}','{}','{0,1}',false,null,1,1,'approved'),

('list_no_markers','List without list markers','structure',
 'Write three separate lines with no numbers, bullets, or connecting words.',
 'List format.','Visual list markers read as content marketing; bare lines read as thinking.',
 'Muat di laci.\nGak berisik.\nGagangnya kependekan.',
 '1. Praktis disimpan\n2. Tidak berisik\n3. Harga terjangkau',
 '{list_of_three}','{}','{0,1,2}',false,null,1,1,'approved'),

('single_sentence_paragraph','Isolate the turn','structure',
 'Put the sentence carrying the turning point on its own line surrounded by blank lines.',
 'Mid and long posts.','Whitespace forces a pause exactly where the meaning changes.',
 '...udah tiga bulan gitu terus.\n\nTernyata cuma salah taruh.\n\nSekarang...',
 'Setelah tiga bulan, saya akhirnya menyadari bahwa saya hanya salah menempatkannya.',
 '{flash_story,confession,before_after,diary}','{}','{0,1,2}',false,null,1,1,'approved'),

('contrast_without_labels','Contrast without labels','structure',
 'Write two adjacent paragraphs describing two states without using any before/after words.',
 'Before-after format.','Naming the structure exposes the persuasion; showing it does not.',
 'Dulu: cari colokan sambil tengkurap.\n\nSekarang: gak.',
 'Sebelum menggunakan produk ini saya kesulitan, setelah menggunakannya semuanya menjadi mudah.',
 '{before_after,diary}','{}','{0,1,2}',false,null,1,1,'approved'),

-- ══════════════════════════ CTA (3)
('afterthought_cta','Comment as afterthought','cta',
 'Write the link comment as if you posted it because someone asked, not to drive a click.',
 'Every post that carries a link.',
 'A comment that reads as an ad triggers reports; one that reads as a reply does not.',
 'yg nanya tadi, ini linknya',
 'Yuk segera dapatkan produknya di link berikut ini!',
 '{}','{}','{1,2}',false,null,1,1,'approved'),

('price_in_comment','Price only in the comment','cta',
 'Keep the price out of the post body and state it only in the link comment.',
 'Soft sell.','A body without a price is read as a story; with one it is read as a listing.',
 'harganya 89rb pas saya cek barusan',
 'Hanya 89 ribu! Buruan sebelum kehabisan!',
 '{}','{}','{1}',false,null,1,1,'approved'),

('no_cta_at_all','No call to action','cta',
 'End the post with no instruction to the reader of any kind.',
 'Zero-sell posts, which must be one post per day.',
 'The daily non-commercial post is what keeps the account from being ranked as a link farm.',
 'Sekarang nyangkut di gantungan sebelah kulkas.',
 'Cek link di komentar ya!',
 '{}','{}','{0}',false,null,1,1,'approved'),

-- ══════════════════════════ ANTI-PATTERNS (3 extra; the regex ones live in banned_phrases)
('no_engagement_bait','No engagement bait','anti_pattern',
 'Never end with a question asking readers to comment their opinion or experience.',
 'Always.','Threads down-ranks recognisable engagement bait and readers recognise it faster.',
 'Sekarang nyangkut di gantungan sebelah kulkas.',
 'Kalian tim yang mana nih? Komen di bawah ya!',
 '{}','{}','{0,1,2}',false,null,1,1,'approved'),

('no_symmetry','No symmetrical pairs','anti_pattern',
 'Never write two clauses with matching grammatical shape inside one sentence.',
 'Always. This is the strongest machine-writing tell.',
 'Balanced parallel construction is the single most reliable signature of generated text.',
 'Murah. Dan ternyata kepakai.',
 'Bukan hanya praktis, tetapi juga sangat terjangkau.',
 '{}','{}','{0,1,2}',false,null,1,1,'approved'),

('no_category_open','Never open with the category','anti_pattern',
 'Never let the product or its category appear in the first eight words.',
 'Always.','A product-first opening is classified as an ad before the second line is read.',
 'Jam setengah 7, telat, tangan licin.',
 'Spatula silikon ini sangat membantu saya di dapur setiap pagi.',
 '{}','{}','{0,1,2}',false,null,1,1,'approved')

ON CONFLICT (code) DO NOTHING;

-- Extra banned phrases that pair with the seed library (regex-enforced by the QA gate)
INSERT INTO banned_phrases (pattern, reason, scope) VALUES
('\y(worth it|value for money|highly recommend|sangat direkomendasikan)\y','frasa review hampa','all'),
('\y(solusi|jawaban) (terbaik|tepat|sempurna)\y','klaim kosong','all'),
('\y(ubah|mengubah) (hidup|cara)\y','klaim berlebihan','all'),
('!{2,}','tanda seru beruntun','all'),
('\y(dijamin|pasti puas|no tipu|amanah)\y','bahasa penjual','all'),
('\y(kalian tim|komen di bawah|tulis di kolom komentar)\y','engagement bait','all'),
('^\s*(spatula|panci|wajan|lampu|kabel|charger|tas|sepatu)\b','buka dengan kategori produk','opener')
ON CONFLICT (pattern, scope) DO NOTHING;
