-- TECHNIQUES MINED FROM Books/ — 26 Malaysian & English copywriting PDFs
--
-- Extracted by reading the highest-signal chunks of each book and converting claims into
-- executable, testable constraints. Same validator as every other technique.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- IMPORTANT EDITORIAL DECISION, PLEASE READ
-- ─────────────────────────────────────────────────────────────────────────────
-- Most of the Malay books teach 2015-era Facebook-ads hard sell: ALL CAPS headlines,
-- "PERCUMA!", "RAHSIA TERBONGKAR!", "CEPAT SEBELUM HABIS", "PM saya sekarang".
-- Measured across the library: "Headlines produk.pdf" alone contains 17,146 ALL-CAPS words
-- and 492 hype triggers; "800 Headline Catchy.pdf" 3,812 ALL-CAPS.
--
-- That surface style is actively harmful on Threads in 2026. It is the single most reliable
-- way to be classified as an ad, get down-ranked, and get reported. Copying it verbatim would
-- destroy the account this system is meant to grow.
--
-- So: the MECHANISMS are extracted (curiosity gaps, specific transformation numbers, one
-- message per audience, close-sale sequencing, dialogue framing). The STYLE is rejected and,
-- where possible, added to banned_phrases instead. Every technique below is rewritten for a
-- feed where readers are hostile to advertising.
--
-- Where a book's claim is unproven or contradicts another book, contested=true so the bandit
-- settles it with your real Shopee data instead of trusting a PDF.
--
-- Run AFTER seed_techniques_my.sql AND after migrations/001_optional_media.sql, which adds
-- the compatible_media column these techniques use. The guard below makes the file safe to run
-- in any order rather than failing with a confusing "column does not exist".

ALTER TABLE techniques ADD COLUMN IF NOT EXISTS compatible_media TEXT[] DEFAULT '{}';

INSERT INTO technique_sources (title, author, notes) VALUES
('Books/ (Malay copywriting library)', 'various Malaysian authors',
 '19 Malay ebooks on copywriting, headlines and close-sale. Mechanisms extracted; hard-sell surface style deliberately rejected.'),
('Books/ (English storytelling library)', 'Kindra Hall, Carmine Gallo, Ekaterina Walter, Jessica Gioglio',
 'The Storyteller''s Secret, The Laws of Brand Storytelling, The Power of Visual Storytelling, Infographics.')
ON CONFLICT DO NOTHING;

INSERT INTO techniques
  (code, name, type, instruction, when_to_use, mechanism, example_do, example_dont,
   compatible_formats, compatible_tones, compatible_intensity, compatible_media,
   contested, contested_note, source_id, corroboration, review_state)
SELECT v.* FROM (VALUES

-- ══════════════════════════════════════════════════════════════════════
-- FROM: 26.Ebook mudahnya copywriting / source-copywriting-30-point
-- ══════════════════════════════════════════════════════════════════════
('one_message_one_person','One message, one audience','structure',
 'Address exactly one problem belonging to one kind of person, and cut any sentence that widens the audience.',
 'Every post. This is the most repeated rule across the Malay library.',
 'A message aimed at everyone is processed as an advertisement; a message aimed at one person is processed as speech.',
 'Untuk yang dapur kecil dan tak muat rak besar. Itu je.',
 'Sesuai untuk semua jenis dapur, besar mahupun kecil, dan semua peringkat umur.',
 '{pov,confession,flash_story,list_of_three}'::text[],'{}'::text[],'{0,1,2}'::smallint[],'{}'::text[],
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Malay%'),3,'approved'),

('answer_first_question','Answer the buyer''s first question','psychology',
 'State plainly what the product does for the reader in the first two lines, before any story or detail.',
 'Utility angle and direct-sell posts.',
 'The 30-point method calls this the keystone question: if the reader cannot tell what this is for, nothing else in the copy can work.',
 'Ni untuk lap dapur yang berminyak lepas masak. Tak payah gosok kuat.',
 'Sebuah inovasi terkini yang bakal mengubah rutin harian anda selama-lamanya.',
 '{one_liner,list_of_three,honest_review}','{deadpan,minimal,gaul}','{1,2}','{}',
 true,'The Malay books say state the benefit immediately; the storytelling books say delay it. Both are in the library, so the bandit decides which wins on Threads.',
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Malay%'),2,'approved'),

('benefit_not_feature','Sell the outcome, not the object','psychology',
 'Replace every product specification with the change it makes to one ordinary moment in the reader''s day.',
 'Any post where you are tempted to list specs.',
 'Takluk Kebaikan Produk: buyers do not buy the object, they buy the version of their day that comes after it.',
 'Lepas masak tak payah rendam periuk semalaman lagi.',
 'Diperbuat daripada silikon gred makanan dengan teras keluli tahan karat.',
 '{}','{}','{1,2}','{}',
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Malay%'),2,'approved'),

-- ══════════════════════════════════════════════════════════════════════
-- FROM: 7-teknik-close-sale-mazhab-copywriting
-- ══════════════════════════════════════════════════════════════════════
('problem_before_offer','Name the problem before the offer','structure',
 'Describe the reader''s problem in their own words before mentioning that a solution exists.',
 'Direct-sell posts, sell_intensity 2.',
 'The close-sale sequence puts permasalahan before tawaran: an offer that arrives before the problem is recognised is heard as an interruption.',
 'Sinki penuh, tangan bau bawang, dan esok kena bangun awal.',
 'Kami ada tawaran istimewa untuk anda hari ini!',
 '{flash_story,confession,pov,honest_review}','{}','{1,2}','{}',
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Malay%'),1,'approved'),

('price_last','Price comes last','cta',
 'Never state the price before the reader knows what the thing does; put it in the comment or the final line.',
 'All posts that mention price at all.',
 'The close-sale flow places sebut harga at step seven of seven. A price stated before value is compared against nothing.',
 'harga RM39 masa saya tengok tadi',
 'RM39 sahaja! Spatula silikon tahan panas!',
 '{}','{}','{1,2}','{}',
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Malay%'),1,'approved'),

('no_hard_close','Never use the hard close','anti_pattern',
 'Never instruct the reader to WhatsApp, PM, inbox, or click now.',
 'Always on Threads.',
 'The Malay ad books recommend "PM saya sekarang" because they were written for Facebook ads. On Threads this is the fastest route to being reported and down-ranked.',
 'yang tanya tadi, ni linknya',
 'Berminat? PM saya sekarang sebelum stok habis!',
 '{}','{}','{0,1,2}','{}',
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Malay%'),3,'approved'),

-- ══════════════════════════════════════════════════════════════════════
-- FROM: Headlines produk / Him-Pun-an-88-Headline / 800 Headline Catchy
-- ══════════════════════════════════════════════════════════════════════
('dialogue_frame','Frame it as overheard dialogue','hook',
 'Write the post as one line of dialogue between two people, with no narration around it.',
 'When the claim would sound boastful in your own voice.',
 'Headlines produk teaches building an ayat perbualan between buyer and seller; quoted speech carries a claim the writer could not make directly.',
 '"Ni yang kau cakap tahan panas tu?"\n"Ha ah. Dah empat bulan."',
 'Pelanggan kami berkata produk ini sangat tahan lama dan berbaloi!',
 '{chat_narration,overheard}','{gaul,deadpan,chaotic}','{0,1}','{}',
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Malay%'),2,'approved'),

('transformation_numbers','Two numbers, before and after','proof',
 'State the before state and the after state as two specific numbers in adjacent lines.',
 'Before-after format where a real measurement exists.',
 'Dulu 115kg, kini 85kg: two concrete numbers do the persuading, so no adjective is needed.',
 'Dulu 20 minit gosok periuk.\nSekarang 4 minit.',
 'Menjimatkan begitu banyak masa anda setiap hari!',
 '{before_after,diary,list_of_three}','{}','{1,2}','{}',
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Malay%'),2,'approved'),

('no_caps_headline','Never shout','anti_pattern',
 'Never write a word in all capitals unless it is a brand name or an acronym.',
 'Always.',
 'The Malay headline books are built on ALL CAPS because they target Facebook ads. On a text-first feed capitals read as spam and are the clearest ad signal available.',
 'Tahan 230 darjah. Dah empat bulan.',
 'TAHAN PANAS 230 DARJAH! MEMANG TERBAIK!',
 '{}','{}','{0,1,2}','{}',
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Malay%'),3,'approved'),

('no_magic_words','Avoid the magic-word list','anti_pattern',
 'Never use PERCUMA, RAHSIA, TERBONGKAR, EKSKLUSIF, TERBUKTI or DISKAUN as attention devices.',
 'Always.',
 'Kopi Writing calls these perkataan ajaib. They were magic in 2015 print and Facebook ads; after a decade of overuse they now mark a post as an advertisement within one line.',
 'Saya tak sangka benda RM39 boleh tahan selama ni.',
 'RAHSIA TERBONGKAR! Formula TERBUKTI berkesan, PERCUMA!',
 '{}','{}','{0,1,2}','{}',
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Malay%'),2,'approved'),

('question_then_gap','Ask, then withhold','hook',
 'Open with one specific question about the reader''s situation and answer only half of it in the post.',
 'Curiosity-gap angle where the link sits in the comment.',
 'The headline books rely on Adakah/Bagaimana/Mengapa openers; the mechanism is the unresolved gap, not the question word.',
 'Kenapa periuk saya senang berkerak tapi jiran punya tak? Rupanya bukan sabun.',
 'Adakah anda mahu tahu RAHSIA periuk sentiasa berkilat?',
 '{question_hook,myth_bust,one_liner}','{deadpan,gaul,warm_sibling}','{0,1}','{}',
 true,'Question openers are the most-taught device in this library and also the most exhausted on social feeds. Worth testing but expect it to underperform.',
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Malay%'),3,'approved'),

-- ══════════════════════════════════════════════════════════════════════
-- FROM: 40 Jenis Konten Media Sosial
-- ══════════════════════════════════════════════════════════════════════
('content_not_catalogue','Be content, not a catalogue','psychology',
 'Write something worth reading even if the reader never clicks anything.',
 'Zero-sell posts, and the daily non-commercial slot.',
 'A feed rewards content and punishes catalogues; the account that only ever sells stops being shown.',
 'Tiga benda dapur yang saya sesal beli. Yang ketiga paling teruk.',
 'Katalog produk terbaru kami! Lihat senarai penuh di link.',
 '{list_of_three,confession,myth_bust,diary}','{}','{0,1}','{}',
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (Malay%'),1,'approved'),

-- ══════════════════════════════════════════════════════════════════════
-- FROM: The Storyteller's Secret (Carmine Gallo)
-- ══════════════════════════════════════════════════════════════════════
('struggle_before_success','Show the struggle, not the win','structure',
 'Spend most of the post on the difficulty and at most one line on the resolution.',
 'Story formats.',
 'Gallo: audiences bond with the struggle, not the triumph. A post that is mostly outcome reads as boasting or as an ad.',
 'Tiga bulan saya salahkan dapur. Tukar gas, tukar api, tanya jiran.\n\nRupanya kuali.',
 'Saya jumpa penyelesaian terbaik dan kini semuanya sempurna!',
 '{flash_story,confession,diary,before_after}','{}','{0,1}','{}',
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (English%'),1,'approved'),

('one_specific_scene','One scene, not a summary','structure',
 'Set the whole post in a single place at a single moment instead of summarising a period of time.',
 'Any story-shaped post.',
 'Gallo: specific scenes are remembered, summaries are not. A summary has no sensory hooks to attach memory to.',
 'Pukul 7 pagi, dapur, tangan berminyak, telefon berdering.',
 'Sepanjang beberapa bulan lepas saya banyak belajar tentang penyediaan makanan.',
 '{flash_story,pov,confession,diary,overheard}','{}','{0,1}','{}',
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (English%'),2,'approved'),

('data_plus_one_person','A number needs a face','proof',
 'Follow any statistic with one named person or one concrete instance of it.',
 'Social-proof and price-shock angles.',
 'Gallo: data informs, story persuades. A statistic alone is forgotten within a line.',
 '4.2k terjual. Termasuk jiran saya, yang beli lepas tengok punya saya.',
 'Lebih 4,200 unit telah terjual di seluruh Malaysia.',
 '{honest_review,overheard,list_of_three}','{}','{1,2}','{}',
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (English%'),1,'approved'),

-- ══════════════════════════════════════════════════════════════════════
-- FROM: The Laws of Brand Storytelling / Power of Visual Storytelling
-- ══════════════════════════════════════════════════════════════════════
('customer_is_hero','The reader is the hero','psychology',
 'Make the reader the subject of the sentence that carries the change, never the product and never yourself.',
 'Always.',
 'The Laws of Brand Storytelling: the brand is the guide, never the hero. A product-as-hero sentence reads as an advertisement.',
 'Awak boleh siapkan dapur dalam empat minit lepas ni.',
 'Produk kami merevolusikan cara anda memasak.',
 '{}','{}','{1,2}','{}',
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (English%'),2,'approved'),

('show_dont_narrate_image','Let the image do its own work','voice',
 'When an image is attached, write only what the photo cannot show.',
 'Image and carousel posts.',
 'The Power of Visual Storytelling: caption and image must carry different information, otherwise one of them is wasted.',
 'Yang tak nampak dalam gambar: bunyi dia bila kena besi. Senyap.',
 'Seperti yang anda lihat dalam gambar, spatula ini berwarna hitam.',
 '{}','{}','{0,1,2}','{IMAGE,CAROUSEL}',
 false,null,
 (SELECT id FROM technique_sources WHERE title LIKE 'Books/ (English%'),1,'approved')

) AS v(code,name,type,instruction,when_to_use,mechanism,example_do,example_dont,
       compatible_formats,compatible_tones,compatible_intensity,compatible_media,
       contested,contested_note,source_id,corroboration,review_state)
ON CONFLICT (code) DO NOTHING;

-- ── Anti-patterns from the books, enforced mechanically by the QA gate.
--
-- NOTE ON SHOUTING: an ALL-CAPS rule cannot live in this table. banned_phrases is applied
-- with PostgreSQL's ~* (case-INsensitive) operator, so [A-Z] also matches lowercase and a
-- shouting regex here silently rejects ordinary Malay copy. Verified: it blocked 4 of 5
-- legitimate test sentences. The shouting check is implemented case-sensitively in
-- n8n/code/qa.js instead.
-- These are the single most valuable extraction: the books demonstrate exactly what
-- 2015 Malaysian hard-sell looks like, which is precisely what must never be published.
INSERT INTO banned_phrases (pattern, reason, scope) VALUES
('\y(PERCUMA|RAHSIA TERBONGKAR|TERBONGKAR|EKSKLUSIF|TERBUKTI BERKESAN)\y',
 'perkataan ajaib gaya iklan FB 2015 - Books/', 'all'),
('\y(PM saya|inbox saya|whatsapp saya|wasap saya|klik link sekarang|tekan link)\y',
 'hard close - Books/', 'all'),
('\y(tawaran istimewa|harga istimewa|promosi hebat|jimat sehingga)\y',
 'bahasa katalog - Books/', 'all'),
('\y(berbaloi sangat|memang terbaik|sangat berkesan|power gila)\y',
 'pujian kosong - Books/', 'all'),
('\y(jangan lepaskan peluang keemasan|sementara stok masih ada|first come first serve)\y',
 'urgency palsu - Books/', 'all')
ON CONFLICT DO NOTHING;
