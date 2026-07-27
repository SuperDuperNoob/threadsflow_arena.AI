-- COLD-START TECHNIQUE LIBRARY — Bahasa Melayu (Malaysia)
--
-- 42 techniques so the system runs with ZERO PDFs uploaded.
-- Instructions stay in English (they are read by the LLM, not published).
-- example_do / example_dont are written natively in Malaysian Malay — these teach the model
-- the target register, so a bad example here poisons every post.
--
-- Malaysian register: tak, nak, dah, je, kot, lah, kan, memang, boleh, jom, tengok, letak, guna.
-- Currency RM. Rojak with English is normal and expected on Malaysian social media.
-- NEVER: banget, nggak, gak, aja, udah, bikin, gimana, kalian (Indonesian)
-- NEVER: bisa (=venom in Malay, use "boleh"), butuh (=vulgar, use "perlu")
--
-- Run INSTEAD OF seed_techniques.sql for a Malaysian account.
-- Requires schema_techniques.sql and schema_kb.sql.

INSERT INTO technique_sources (id, title, author, notes)
VALUES (1, 'ThreadsFlow baseline (MY)', 'built-in',
        'Hand-written cold-start library, Malaysian Malay. Survives with zero uploaded documents.')
ON CONFLICT DO NOTHING;
SELECT setval(pg_get_serial_sequence('technique_sources','id'),
              GREATEST((SELECT max(id) FROM technique_sources), 1));

INSERT INTO techniques
  (code, name, type, instruction, when_to_use, mechanism, example_do, example_dont,
   compatible_formats, compatible_tones, compatible_intensity, contested, contested_note,
   source_id, corroboration, review_state)
VALUES

-- ══════════════════════════ HOOKS (12)
('sensory_open','Sensory opening','hook',
 'Name a physical sensation the reader felt in the last 7 days before naming any product category.',
 'Cold audience that has no reason to care yet.',
 'Recognition fires faster than persuasion; the reader confirms before they evaluate.',
 'Tangan licin masa angkat periuk panas, pukul 7 pagi, dah lambat.',
 'Pernah tak rasa tangan licin masa masak? Produk ini penyelesaiannya.',
 '{}','{deadpan,gaul,warm_sibling,chaotic,minimal}','{0,1}',false,null,1,1,'approved'),

('exact_time_open','Exact time opening','hook',
 'Open by stating the exact clock time the situation happened.',
 'Any story-shaped post.','A specific timestamp reads as memory, not as marketing.',
 'Pukul 11.40 malam, masih cari plug kat bilik sewa.',
 'Pada suatu malam saya menghadapi kesukaran mencari palam elektrik.',
 '{flash_story,confession,diary,pov,overheard}','{}','{0,1,2}',false,null,1,1,'approved'),

('mid_action_open','Start mid-action','hook',
 'Begin the first sentence in the middle of an action already in progress, with no setup.',
 'Short formats where setup would eat the whole post.',
 'Missing context creates a gap the reader fills by continuing.',
 'Dah tiga kali patah balik ke rak yang sama.',
 'Semasa saya sedang membeli-belah di pasar raya, saya kembali ke rak yang sama tiga kali.',
 '{flash_story,one_liner,pov,chat_narration}','{}','{0,1}',false,null,1,1,'approved'),

('overheard_line_open','Open on someone else''s words','hook',
 'Open with a short line another person said, before explaining who said it.',
 'When you want distance from the sell.','Quoted speech is heard as evidence, not as a claim.',
 '"Beli yang murah je, nanti rosak jugak." Ayah cakap, 2019.',
 'Ayah saya pernah menyatakan bahawa kita sebaiknya membeli barang yang murah.',
 '{overheard,chat_narration,confession,myth_bust}','{}','{0,1}',false,null,1,1,'approved'),

('number_first_open','Lead with a raw number','hook',
 'Make the first thing in the post a number with its unit, before any sentence.',
 'Utility and price-driven posts.','A bare number is unusual enough in a feed to stop a thumb.',
 '11 cm. Itu panjang pemegang dia, dan itu masalahnya.',
 'Pemegangnya agak pendek, dalam 11 cm sahaja.',
 '{list_of_three,one_liner,honest_review,before_after}','{deadpan,minimal}','{1,2}',false,null,1,1,'approved'),

('wrong_assumption_open','Open on a wrong assumption','hook',
 'State something the reader probably believes as if it were true, then contradict it in the next sentence.',
 'Crowded categories where everyone says the same thing.',
 'Contradiction of a held belief demands resolution.',
 'Katanya makin mahal makin tahan lama. Punya saya RM39 dah 8 bulan.',
 'Ramai yang menyangka barang mahal pasti lebih tahan lama, walhal belum tentu.',
 '{myth_bust,honest_review,one_liner}','{deadpan,gaul,warm_sibling}','{1,2}',false,null,1,1,'approved'),

('unfinished_open','Open with an unfinished thought','hook',
 'Write a first line that is grammatically incomplete and resolve it in the second line.',
 'Micro-length posts.','An open syntactic loop is uncomfortable to abandon.',
 'Tiga bulan tangguh beli benda ni sebab.\nSebab ingat RM39 tu mahal.',
 'Saya telah menangguhkan pembelian ini selama tiga bulan kerana harganya.',
 '{one_liner,confession,flash_story}','{chaotic,gaul,deadpan}','{0,1}',false,null,1,1,'approved'),

('name_the_person_open','Name a specific person','hook',
 'Open by naming a specific role-person in your life rather than a generic group.',
 'Identity and social-proof angles.','A named individual is concrete; an audience is abstract.',
 'Adik saya yang bilik sewa 3x3 meter tu dah mengalah.',
 'Ramai penyewa bilik kecil menghadapi masalah seperti ini.',
 '{flash_story,pov,chat_narration,confession}','{warm_sibling,gaul,deadpan}','{0,1}',false,null,1,1,'approved'),

('cost_comparison_open','Open on an unrelated cost','hook',
 'Open by naming a routine everyday expense, then place the product price against it.',
 'Price-shock angle only.','Reframing anchors the price against something already accepted.',
 'Kopi semalam RM14. Ni RM39 dan pakai tiap hari sejak Mac.',
 'Harganya sangat berpatutan, hanya RM39 sahaja.',
 '{one_liner,list_of_three,honest_review}','{deadpan,minimal,gaul}','{1,2}',false,null,1,1,'approved'),

('refusal_open','Open by refusing','hook',
 'Open by stating who should not buy this, using a specific disqualifying condition.',
 'Direct-sell posts where trust is the bottleneck.',
 'Exclusion signals honesty and raises perceived selectivity.',
 'Kalau dapur korang dah ada yang macam ni, tak payah. Serius.',
 'Produk ini sesuai untuk semua orang yang gemar memasak.',
 '{honest_review,myth_bust,confession}','{deadpan,minimal}','{1,2}',false,null,1,1,'approved'),

('counting_open','Open with a running count','hook',
 'Open by stating how many times something has happened, using an exact count.',
 'Diary and repetition formats.','A tally implies duration and real use.',
 'Kali ketujuh saya basuh benda ni. Warna belum luntur.',
 'Sudah beberapa kali dibasuh dan warnanya masih elok.',
 '{diary,honest_review,before_after}','{}','{1}',false,null,1,1,'approved'),

('object_first_open','Open on the object, not the person','hook',
 'Make a physical object the grammatical subject of the first sentence.',
 'Minimal and deadpan tones.','Removing the narrator removes the salesperson.',
 'Pemegang plastik dia cair sikit kat tepi kanan.',
 'Saya mendapati bahawa pemegang plastiknya sedikit cair.',
 '{honest_review,diary,one_liner}','{deadpan,minimal}','{0,1}',false,null,1,1,'approved'),

-- ══════════════════════════ PROOF (7)
('flaw_first','Flaw before benefit','proof',
 'State one measurable drawback using a real number before mentioning any benefit.',
 'Skeptical audiences and any direct-sell post.',
 'A volunteered concession buys credibility for everything that follows.',
 'Pemegang 11 cm, pendek sikit untuk tangan besar. Tapi 90 saat dah panas rata.',
 'Produk ini hampir sempurna, cuma ada sedikit kekurangan kecil.',
 '{honest_review,myth_bust,confession,before_after}','{deadpan,minimal,warm_sibling,gaul}','{1,2}',false,null,1,1,'approved'),

('odd_number_proof','Odd numbers over round','proof',
 'Quote a non-round measured number instead of a rounded estimate for any result.',
 'Whenever you state a result.','Round numbers read as estimates; odd numbers read as measurements.',
 'Panas dalam 93 saat atas dapur saya.',
 'Panas dalam masa lebih kurang 2 minit.',
 '{}','{}','{1,2}',false,null,1,1,'approved'),

('duration_proof','Elapsed-time proof','proof',
 'State how long you have owned the item in weeks or months instead of describing durability.',
 'Any claim about quality lasting.','Duration is checkable; "durable" is not.',
 'Pakai tiap hari sejak Mac. Belum ada apa-apa yang tercabut.',
 'Kualitinya sangat tahan lama dan berkekalan.',
 '{diary,honest_review,before_after}','{}','{1,2}',false,null,1,1,'approved'),

('real_review_paraphrase','Paraphrase a real review','proof',
 'Paraphrase one actual buyer review in that buyer''s own register, never inventing a new one.',
 'Social-proof angle.','Borrowed specificity you could not have invented yourself.',
 'Ada orang tulis dalam review: "bising sikit tapi kuat". Betul jugak.',
 'Ramai pembeli menyatakan bahawa produk ini amat memuaskan.',
 '{honest_review,overheard,myth_bust}','{}','{1,2}',false,null,1,1,'approved'),

('failure_case_proof','Name where it failed','proof',
 'Describe one specific situation where the product did not work well.',
 'High-trust posts and expensive-feeling categories.',
 'A stated boundary makes the working cases believable.',
 'Untuk kuali yang pemegang bulat, benda ni tak tersangkut. Yang leper okay.',
 'Sesuai digunakan untuk pelbagai jenis peralatan memasak.',
 '{honest_review,myth_bust}','{deadpan,minimal,warm_sibling}','{1,2}',false,null,1,1,'approved'),

('sold_count_proof','Use the real sold count','proof',
 'Quote the actual sold count from the listing verbatim rather than describing popularity.',
 'Social proof when the number is genuinely large.',
 'Verifiable numbers transfer trust; adjectives do not.',
 '4.2k terjual. Saya salah seorang, bulan lepas.',
 'Produk ini sangat laris dan ramai yang membelinya.',
 '{}','{deadpan,gaul,minimal}','{1,2}',true,
 'Works only when the number is large. Below ~200 sold, naming it reduces trust rather than building it.',
 1,1,'approved'),

('no_superlative_proof','Comparative not superlative','proof',
 'Compare against one named alternative you actually used instead of claiming it is the best.',
 'Any comparison.','A bounded comparison is checkable; a superlative is a red flag.',
 'Lagi senang pegang berbanding yang stainless punya kakak saya.',
 'Ini adalah spatula terbaik yang pernah wujud.',
 '{}','{}','{1,2}',false,null,1,1,'approved'),

-- ══════════════════════════ VOICE (4) + RHYTHM (1) + STRUCTURE(1 abrupt_end)
('one_idea_sentence','One idea per sentence','voice',
 'Limit every sentence to a single idea and cut any sentence carrying two.',
 'Always.','Feeds are read at speed; compound sentences get skipped.',
 'Pemegang dia pendek. Untuk saya okay je. Untuk suami saya tak.',
 'Pemegangnya pendek sehingga bagi saya ia tidak menjadi masalah namun bagi suami saya ia menjadi kesukaran.',
 '{}','{}','{0,1,2}',false,null,1,1,'approved'),

('uneven_rhythm','Uneven sentence lengths','rhythm',
 'Place one sentence of three words or fewer next to a much longer sentence.',
 'Any post longer than 120 characters.',
 'Regular rhythm reads as written; irregular rhythm reads as spoken.',
 'Saya tangguh tiga bulan sebab ingat RM39 tu mahal untuk benda macam ni. Bodoh betul.',
 'Saya menangguhkan pembelian selama tiga bulan. Saya fikir harganya agak mahal.',
 '{}','{}','{0,1,2}',false,null,1,1,'approved'),

('no_explaining_emotion','Show, never name the feeling','voice',
 'Delete any sentence that names an emotion and replace it with the action that caused it.',
 'Always.','Naming a feeling asks for belief; showing the cause earns it.',
 'Saya berdiri kat dapur pandang benda tu sampai seminit.',
 'Saya berasa amat kecewa dan hampa dengan keadaan ini.',
 '{}','{}','{0,1,2}',false,null,1,1,'approved'),

('abrupt_end','End without resolving','structure',
 'End the post on the last concrete detail without any summary or conclusion.',
 'Story-shaped posts.','A tidy ending signals a written piece; an abrupt one signals a real thought.',
 'Sekarang tersangkut kat penyangkut sebelah peti ais.',
 'Kesimpulannya, produk ini benar-benar mengubah cara saya memasak setiap hari.',
 '{flash_story,confession,diary,pov,overheard}','{}','{0,1}',false,null,1,1,'approved'),

('lowercase_drift','Let the register slip','voice',
 'Write at least one clause the way it would be typed in a hurry, without fixing it.',
 'Casual tones only. Never for minimal or corporate parody.',
 'Small imperfections are the strongest human signal available in text.',
 'btw yg warna hitam stok tinggal sikit td masa tengok',
 'Sebagai makluman tambahan, stok bagi varian warna hitam kelihatan semakin berkurangan.',
 '{confession,chat_narration,overheard}','{gaul,chaotic}','{0,1}',false,null,1,1,'approved'),

('second_person_singular','Write to one person','voice',
 'Address a single reader using singular pronouns and never address a group.',
 'Always.','Broadcast language triggers ad-recognition; direct address does not.',
 'Kalau meja awak sempit macam saya punya, ni muat.',
 'Bagi anda semua yang mempunyai meja bersaiz kecil, produk ini amat sesuai.',
 '{}','{}','{0,1,2}',false,null,1,1,'approved'),

-- ══════════════════════════ PSYCHOLOGY (7)
('specific_persona_target','Disqualify to qualify','psychology',
 'Name a narrow group with one unusual shared condition rather than a broad demographic.',
 'Identity angle.','Narrow targeting increases response from the target more than it loses outside it.',
 'Untuk yang kerja shift malam dan tak boleh bising pukul 2 pagi.',
 'Sesuai untuk sesiapa sahaja yang memerlukan.',
 '{pov,confession,flash_story,list_of_three}','{}','{0,1,2}',false,null,1,1,'approved'),

('objection_preempt','Answer the doubt before it forms','psychology',
 'Name the reader''s most likely objection in your own words before making any claim.',
 'Direct-sell posts.','A stated objection cannot be used as a reason to leave.',
 'Ya, plastik. Saya pun ingat akan nampak murah. Rupanya tak.',
 'Walaupun diperbuat daripada plastik, kualitinya tetap sangat baik.',
 '{honest_review,myth_bust,confession}','{}','{1,2}',false,null,1,1,'approved'),

('delayed_product','Delay the product','structure',
 'Do not mention the product or its category until after the halfway point of the post.',
 'Soft-sell and zero-sell posts.','Engagement earned before the pitch survives the pitch.',
 'Tiga bulan saya salahkan dapur. Rupanya kuali.',
 'Kuali ini adalah penyelesaian terbaik untuk masalah memasak anda.',
 '{flash_story,confession,diary,overheard,pov}','{}','{0,1}',false,null,1,1,'approved'),

('curiosity_withhold','Withhold the mechanism','psychology',
 'State the outcome plainly but leave the reason for it unstated in the post body.',
 'Curiosity-gap angle, where the comment carries the link.',
 'An unexplained result drives people to the comments, which is where your link lives.',
 'Pinggan bertimbun kurang separuh dan saya tak beli apa-apa yang mahal.',
 'Dengan produk ini, cucian pinggan anda akan berkurangan dengan ketara!',
 '{one_liner,flash_story,before_after}','{deadpan,minimal,gaul}','{0,1}',false,null,1,1,'approved'),

('cost_of_inaction','Price the delay','psychology',
 'Quantify what continuing the current behaviour costs in time or money over a stated period.',
 'Utility angle for practical products.',
 'Loss framing outperforms gain framing when the loss is already being incurred.',
 'Sepuluh minit tiap malam. Sebulan jadi 5 jam gosok periuk.',
 'Menjimatkan banyak masa anda setiap hari!',
 '{list_of_three,honest_review,before_after}','{deadpan,warm_sibling,minimal}','{1,2}',false,null,1,1,'approved'),

('mundane_specificity','Boring specifics','psychology',
 'Include one irrelevant, boring detail that no advertisement would ever bother to include.',
 'Always. This is the highest-value technique in the library.',
 'Irrelevant detail cannot be strategic, so the reader stops reading strategically.',
 'Sampai hari Rabu, rider letak kat kedai runcit sebelah.',
 'Penghantaran sangat pantas dan perkhidmatannya memuaskan.',
 '{}','{}','{0,1,2}',false,null,1,1,'approved'),

('status_quo_defense','Defend not buying','psychology',
 'Explicitly tell the reader their current solution is probably fine.',
 'Zero and soft sell.','Removing pressure removes the reason to resist.',
 'Kalau yang sekarang masih boleh pakai, guna je lah. Saya cerita je ni.',
 'Jangan lepaskan peluang, dapatkan sekarang juga!',
 '{confession,honest_review,diary}','{deadpan,minimal,warm_sibling}','{0,1}',false,null,1,1,'approved'),

-- ══════════════════════════ STRUCTURE (4)
('three_beat_story','Three beats only','structure',
 'Structure the post as exactly three beats: ordinary situation, small turn, concrete last image.',
 'Flash story format.','Three beats is the shortest complete narrative shape.',
 'Tiap pagi kelam-kabut.\nSemalam cuba pindah ke laci atas.\nPagi ni keluar rumah 4 minit lagi awal.',
 'Dahulu saya menghadapi kesukaran, kemudian saya menemui penyelesaian, dan kini hidup saya jauh lebih baik.',
 '{flash_story,before_after,diary}','{}','{0,1}',false,null,1,1,'approved'),

('list_no_markers','List without list markers','structure',
 'Write three separate lines with no numbers, bullets, or connecting words.',
 'List format.','Visual list markers read as content marketing; bare lines read as thinking.',
 'Muat dalam laci.\nTak bising.\nPemegang pendek sikit.',
 '1. Praktikal disimpan\n2. Tidak bising\n3. Harga berpatutan',
 '{list_of_three}','{}','{0,1,2}',false,null,1,1,'approved'),

('single_sentence_paragraph','Isolate the turn','structure',
 'Put the sentence carrying the turning point on its own line surrounded by blank lines.',
 'Mid and long posts.','Whitespace forces a pause exactly where the meaning changes.',
 '...dah tiga bulan macam tu.\n\nRupanya salah letak je.\n\nSekarang...',
 'Selepas tiga bulan, saya akhirnya menyedari bahawa saya hanya tersalah meletakkannya.',
 '{flash_story,confession,before_after,diary}','{}','{0,1,2}',false,null,1,1,'approved'),

('contrast_without_labels','Contrast without labels','structure',
 'Write two adjacent paragraphs describing two states without using any before/after words.',
 'Before-after format.','Naming the structure exposes the persuasion; showing it does not.',
 'Dulu: cari plug sambil meniarap.\n\nSekarang: tak.',
 'Sebelum menggunakan produk ini saya menghadapi kesukaran, selepas menggunakannya semuanya menjadi mudah.',
 '{before_after,diary}','{}','{0,1,2}',false,null,1,1,'approved'),

-- ══════════════════════════ CTA (3)
('afterthought_cta','Comment as afterthought','cta',
 'Write the link comment as if you posted it because someone asked, not to drive a click.',
 'Every post that carries a link.',
 'A comment that reads as an ad triggers reports; one that reads as a reply does not.',
 'yang tanya tadi, ni linknya',
 'Jom dapatkan produk ini di pautan berikut!',
 '{}','{}','{1,2}',false,null,1,1,'approved'),

('price_in_comment','Price only in the comment','cta',
 'Keep the price out of the post body and state it only in the link comment.',
 'Soft sell.','A body without a price is read as a story; with one it is read as a listing.',
 'harga RM39 masa saya tengok tadi',
 'Hanya RM39! Cepat sebelum kehabisan!',
 '{}','{}','{1}',false,null,1,1,'approved'),

('no_cta_at_all','No call to action','cta',
 'End the post with no instruction to the reader of any kind.',
 'Zero-sell posts, which must be one post per day.',
 'The daily non-commercial post is what keeps the account from being ranked as a link farm.',
 'Sekarang tersangkut kat penyangkut sebelah peti ais.',
 'Tengok link dalam komen ya!',
 '{}','{}','{0}',false,null,1,1,'approved'),

-- ══════════════════════════ ANTI-PATTERNS (4)
('no_engagement_bait','No engagement bait','anti_pattern',
 'Never end with a question asking readers to comment their opinion or experience.',
 'Always.','Threads down-ranks recognisable engagement bait and readers recognise it faster.',
 'Sekarang tersangkut kat penyangkut sebelah peti ais.',
 'Korang tim mana ni? Komen kat bawah ya!',
 '{}','{}','{0,1,2}',false,null,1,1,'approved'),

('no_symmetry','No symmetrical pairs','anti_pattern',
 'Never write two clauses with matching grammatical shape inside one sentence.',
 'Always. This is the strongest machine-writing tell.',
 'Balanced parallel construction is the most reliable signature of generated text.',
 'Murah. Dan rupanya berguna.',
 'Bukan sahaja praktikal, tetapi juga sangat berpatutan.',
 '{}','{}','{0,1,2}',false,null,1,1,'approved'),

('no_category_open','Never open with the category','anti_pattern',
 'Never let the product or its category appear in the first eight words.',
 'Always.','A product-first opening is classified as an ad before the second line is read.',
 'Pukul 7 pagi, dah lambat, tangan licin.',
 'Spatula silikon ini sangat membantu saya di dapur setiap pagi.',
 '{}','{}','{0,1,2}',false,null,1,1,'approved'),

('no_indonesian_slang','Never use Indonesian slang','anti_pattern',
 'Never use Jakarta slang such as banget, nggak, gak, aja, udah, bikin, gimana or kalian.',
 'Always. The audience is Malaysian.',
 'Indonesian slang marks the account as foreign or as a reposting bot, and two common words are false friends: bisa means venom in Malay, butuh is vulgar.',
 'Tak sedap sangat, tapi boleh tahan lah.',
 'Nggak enak banget sih, tapi bisa lah.',
 '{}','{}','{0,1,2}',false,null,1,1,'approved')

ON CONFLICT (code) DO NOTHING;
