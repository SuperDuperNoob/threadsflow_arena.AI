-- LEVERS — Bahasa Melayu (Malaysia)
--
-- IMPORTANT: this is NOT a translation of seed_levers.sql. Malay and Indonesian look similar
-- but differ in vocabulary, register and idiom, and several words are outright false friends:
--
--   Indonesian          Malay              Trap
--   ----------          -----              ----
--   bisa   = can        bisa = venom       use "boleh"
--   butuh  = need       butuh = vulgar     use "perlu"
--   percuma= free       percuma = useless  never use for "free"; use "percuma" ONLY as useless
--   pusing = dizzy      pusing = to turn   use "sakit kepala"
--   budak  = slave      budak = kid        fine in MY, offensive in ID
--   banget/nggak/aja/udah/bikin/gimana/kalian  -> Jakarta slang, reads foreign in Malaysia
--
-- Malaysian casual register uses: tak (not), nak (want), dah (already), je (just), kot (maybe),
-- lah/kan/eh particles, memang, boleh, jom, tengok, cuba, letak, guna.
-- Rojak (Malay-English mixing) is normal and expected on Malaysian social media.
--
-- Run INSTEAD OF seed_levers.sql for a Malaysian account.

INSERT INTO levers (kind, code, label, brief) VALUES
-- ── FORMAT (12)
('format','flash_story','Cerita kilat','Tulis sebagai cerita mikro 3 babak: keadaan biasa -> satu perubahan kecil -> penutup yang tergantung. Jangan ada narator yang terangkan pengajaran.'),
('format','confession','Pengakuan','Nada pengakuan peribadi, macam menaip dalam Notes pukul 1 pagi. Boleh malu sikit, boleh mengaku tabiat buruk sendiri.'),
('format','pov','POV','Mula dari sudut pandang orang kedua dalam satu saat yang spesifik. Jangan tulis perkataan "POV:" secara literal.'),
('format','chat_narration','Cerita balik perbualan','Ceritakan semula perbualan pendek dengan kawan, pasangan atau mak. Petikan pendek, tanpa tanda petik formal.'),
('format','list_of_three','Tiga perkara','Tiga pemerhatian pendek. Tiada nombor, tiada bullet. Baris berasingan. Perkara ketiga paling tajam.'),
('format','one_liner','Satu baris','Maksimum dua ayat pendek. Kuat, sedikit kabur, buat orang tekan komen.'),
('format','honest_review','Review jujur','Sebut satu kelemahan sebenar dahulu sebelum kelebihan. Spesifik dan boleh diukur.'),
('format','diary','Diari hari ke-N','"Hari ke-N guna..." dengan butiran deria yang kecil, bukan spesifikasi produk.'),
('format','myth_bust','Pecahkan tanggapan','Buka dengan anggapan umum yang salah, kemudian patahkan dengan pengalaman sendiri.'),
('format','overheard','Terdengar','Ceritakan sesuatu yang kebetulan terdengar di tempat awam atau dalam group WhatsApp.'),
('format','before_after','Sebelum-selepas','Dua perenggan yang berlawanan tanpa guna perkataan "sebelum" atau "selepas". Biar pembaca sendiri yang faham.'),
('format','question_hook','Soalan umpan','Buka dengan soalan yang sangat spesifik (bukan soalan retorik umum), kemudian jawab separuh sahaja.'),

-- ── ANGLE (9)
('angle','problem_agitate','Masalah dibesarkan','Fokus pada satu kerenah harian yang sangat spesifik yang diselesaikan produk ini. Jangan sebut penyelesaian dalam ayat pertama.'),
('angle','before_after','Beza hasil','Fokus pada perubahan hasil yang boleh diukur atau dirasa.'),
('angle','price_shock','Terkejut harga','Bandingkan dengan perbelanjaan harian yang setara. Guna angka sebenar dari data produk.'),
('angle','social_proof','Bukti orang lain','Guna jumlah terjual atau rating sebenar, atau petikan review sebenar. Jangan reka angka.'),
('angle','scarcity','Terhad','Hanya jika betul: stok atau promosi terhad. Kalau tiada data, jangan guna angle ini.'),
('angle','curiosity_gap','Ruang ingin tahu','Sebut hasilnya tanpa sebut sebabnya. Sebabnya ada dalam komen.'),
('angle','identity','Identiti','Cakap pada kumpulan yang sangat spesifik ("yang bilik sewa sempit", "yang kerja shift malam").'),
('angle','utility','Manfaat dulu','Beri tip yang berguna walaupun orang tak beli apa-apa. Produk muncul kemudian sebagai nota kaki.'),
('angle','contrarian','Lawan arus','Ambil pendirian yang bertentangan dengan pendapat umum tentang kategori produk ini.'),

-- ── TONE (7)
('tone','deadpan','Datar','Datar, tiada emoji, tiada tanda seru. Kalau ada humor, jenis kering.'),
('tone','gaul','Santai','Bahasa Melayu pasar harian: tak, nak, dah, je, kot, lah. Rojak dengan English yang biasa dipakai orang Malaysia. Maksimum 1 emoji.'),
('tone','warm_sibling','Macam abang/kakak','Mesra, menenangkan, macam abang atau kakak bagi nasihat. Jangan berlagak pandai.'),
('tone','corporate_parody','Parodi korporat','Tiru bahasa pejabat secara melampau untuk lawak, kemudian pecah pada ayat terakhir.'),
('tone','chaotic','Bersepah','Ayat terputus-putus, lompat topik sedikit, tapi kekal satu idea utama.'),
('tone','minimal','Minimalis','Ayat pendek. Banyak ruang kosong. Tiada emoji. Tiada hashtag.'),
('tone','enthusiast','Teruja','Teruja tapi spesifik. Keterujaan mesti ada sebab konkrit, bukan kata sifat kosong.'),

-- ── SELL INTENSITY (3)
('sell_intensity','0','Tiada jualan','Langsung tidak sebut membeli. Tiada CTA. Komen pertama TIDAK mengandungi link.'),
('sell_intensity','1','Jualan lembut','Sebut produk sekali, tanpa ajak beli. CTA dalam komen bersifat maklumat sahaja.'),
('sell_intensity','2','Terus terang','Boleh ajak terus, tetapi tanpa perkataan "cepat" atau "sebelum kehabisan".'),

-- ── MEDIA TYPE (3)
('media_type','TEXT','Teks sahaja','Tiada gambar. Ayat pertama mesti berdiri sendiri sebab tiada visual yang menahan skrol. Butiran deria mesti dibawa oleh perkataan.'),
('media_type','IMAGE','Satu gambar','Satu gambar menyertai post. Jangan huraikan semula apa yang sudah nampak dalam gambar.'),
('media_type','CAROUSEL','Carousel','Beberapa gambar. Teks boleh rujuk urutan, bukan satu gambar sahaja.'),

-- ── LENGTH (3)
('length_band','micro','Mikro','Maksimum 120 aksara.'),
('length_band','mid','Sederhana','120-260 aksara.'),
('length_band','long','Panjang','260-480 aksara. Guna 2-3 perenggan pendek.');

-- ── BANNED PHRASES (Malay). Regex, case-insensitive, enforced on every post by the QA gate.
INSERT INTO banned_phrases (pattern, reason, scope) VALUES
('^(korang|korang pernah|siapa kat sini|ada tak yang|sesiapa yang)', 'pembuka klise', 'opener'),
('pernah tak korang', 'pembuka klise', 'all'),
('\yjom\y.*\y(beli|order|checkout)\y', 'ajakan jualan lemah', 'all'),
('\y(cepat sebelum|jangan lepaskan peluang|stok terhad|limited stock|sementara stok ada)\y', 'urgency palsu', 'all'),
('bukan sahaja .{1,30}, tetapi juga', 'binaan selari khas AI', 'all'),
('\y(game.?changer|wajib ada|must have|berbaloi sangat|terbaik dari ladang)\y', 'frasa kosong', 'all'),
('\y(di era (digital|moden)|pada zaman sekarang|dewasa ini)\y', 'pembuka kosong', 'all'),
('\y(marilah kita|tidak dapat dinafikan|adalah amat)\y', 'formal kaku', 'all'),
('\y(semoga bermanfaat|selamat membeli|happy shopping)\y', 'penutup klise', 'all'),
('—.*—', 'em-dash berantai', 'all'),
('(#\w+\s*){2,}', 'timbunan hashtag', 'all'),
('([^\u0000-\u2fff]\s*){3,}', 'baris emoji (regex Postgres, bukan JS)', 'all'),
('!{2,}', 'tanda seru berganda', 'all'),
('\y(dijamin|confirm puas|amanah|100% original)\y', 'bahasa penjual', 'all'),
('\y(korang tim mana|komen kat bawah|tulis dalam komen)\y', 'umpan engagement', 'all'),
-- ── Indonesian words that must never appear (wrong country, or false friends)
('\y(banget|nggak|gak|aja|udah|bikin|gimana|kalian|doang|cowok|cewek|kaya gini)\y',
 'perkataan Indonesia - salah negara', 'all'),
('\ybisa\y', 'bisa = racun dalam BM; guna boleh', 'all'),
('\ybutuh\y', 'butuh = lucah dalam BM; guna perlu', 'all'),
('\ypusing\y', 'pusing = berputar dalam BM, bukan sakit kepala', 'all'),
('(\yrupiah\y|\yRp\.? ?[0-9])', 'mata wang salah - guna RM', 'all')
ON CONFLICT DO NOTHING;

-- ── CTA POOL (Malay). {{link}} is replaced with the tracked short URL.
INSERT INTO cta_variants (text) VALUES
('link dia kat sini {{link}}'),
('yang tanya tadi, ni dia {{link}}'),
('letak sini senang, tak payah tanya satu-satu {{link}}'),
('ni yang saya guna {{link}}'),
('sebelum terlupa {{link}}'),
('untuk yang nak tengok harga {{link}}'),
('detail penuh kat sini {{link}}'),
('saya beli kat sini {{link}}'),
('ni {{link}}'),
('barangnya {{link}}'),
('tengok sendiri lah ya {{link}}'),
('yang DM semalam, ni dia {{link}}'),
('kalau nak tengok-tengok dulu {{link}}'),
('spec dengan harga ada kat sini {{link}}'),
('ada kat sini {{link}}')
ON CONFLICT DO NOTHING;

-- ── SETTINGS (Malaysian defaults)
INSERT INTO settings (key, value) VALUES
('posting', '{
  "posts_per_day": 5,
  "slot_hours": [7, 12, 15, 20, 22],
  "jitter_minutes": 18,
  "skip_probability": 0.08,
  "carousel_probability": 0.4,
  "reply_delay_range_sec": [45, 120],
  "daily_zero_sell_posts": 1,
  "image_cooldown_days": 10,
  "timezone": "Asia/Kuala_Lumpur"
}'),
('bandit', '{
  "epsilon": 0.25, "decay": 0.9, "cycle_days": 3, "min_n_for_combo": 4,
  "winner_top_pct": 0.2, "loser_bottom_pct": 0.3, "loser_cooldown_days": 9,
  "money_shrinkage_target_orders": 20
}'),
('scoring', '{"w_epm": 0.55, "w_ctr": 0.25, "w_eng": 0.20,
  "eng_weights": {"likes":1, "replies":3, "reposts":5, "quotes":4}}'),
('qa', '{"max_similarity": 0.86, "similarity_lookback": 30, "max_retries": 3,
  "max_chars": 480, "max_emoji": 2, "hashtag_probability": 0.4}'),
('locale', '{"language":"ms-MY","country":"MY","currency":"MYR",
  "timezone":"Asia/Kuala_Lumpur","shopee_domain":"shopee.com.my"}')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
