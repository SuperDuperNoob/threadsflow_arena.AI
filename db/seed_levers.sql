-- Seed data: levers, banned phrases, CTA pool, settings.
-- Language of output copy = Bahasa Indonesia casual. Change `brief` text to switch language.

INSERT INTO levers (kind, code, label, brief) VALUES
-- ── FORMAT (12)
('format','flash_story','Flash story','Tulis sebagai cerita mikro 3 beat: situasi biasa → titik balik kecil → penutup yang menggantung. Tanpa narator yang menjelaskan moral.'),
('format','confession','Pengakuan','Nada pengakuan pribadi, seperti nulis di notes jam 1 pagi. Boleh agak malu-malu, boleh mengakui kebiasaan buruk.'),
('format','pov','POV','Mulai dari sudut pandang orang kedua di satu momen spesifik. Tanpa kata "POV:" secara literal.'),
('format','chat_narration','Narasi chat','Ceritakan ulang percakapan singkat dengan teman/pasangan/ibu. Kutipan pendek, tanpa tanda kutip formal.'),
('format','list_of_three','Tiga poin','Tiga observasi pendek, tanpa nomor, tanpa bullet. Baris terpisah. Poin ketiga yang paling tajam.'),
('format','one_liner','Satu baris','Maksimum dua kalimat pendek. Kuat, ambigu, bikin orang buka komentar.'),
('format','honest_review','Review jujur','Sebutkan satu kekurangan nyata sebelum kelebihan. Spesifik dan terukur.'),
('format','diary','Diary hari ke-N','"Hari ke-N pakai ..." dengan detail sensorik kecil, bukan spesifikasi produk.'),
('format','myth_bust','Bantah mitos','Buka dengan asumsi umum yang salah, lalu patahkan dengan pengalaman sendiri.'),
('format','overheard','Nguping','Ceritakan sesuatu yang "kedengeran" di tempat umum atau di grup WA.'),
('format','before_after','Sebelum-sesudah','Dua paragraf kontras tanpa kata "sebelum"/"sesudah". Biarkan pembaca yang menyimpulkan.'),
('format','question_hook','Pancingan','Buka dengan pertanyaan yang sangat spesifik (bukan pertanyaan retoris umum), lalu jawab sendiri setengahnya.'),

-- ── ANGLE (9)
('angle','problem_agitate','Masalah diperbesar','Fokus pada rasa kesal harian yang sangat spesifik yang dipecahkan produk ini. Jangan sebut solusinya di kalimat pertama.'),
('angle','before_after','Kontras hasil','Fokus pada perubahan hasil yang bisa diukur atau dirasakan.'),
('angle','price_shock','Kaget harga','Bandingkan dengan pengeluaran sehari-hari yang setara. Gunakan angka nyata dari data produk.'),
('angle','social_proof','Bukti sosial','Gunakan angka terjual/rating nyata atau kutipan review nyata. Jangan mengarang angka.'),
('angle','scarcity','Kelangkaan','Hanya jika benar: stok/promo terbatas. Kalau tidak ada data, jangan pakai angle ini.'),
('angle','curiosity_gap','Celah rasa ingin tahu','Sebutkan hasil tanpa menyebutkan penyebab. Penyebabnya ada di komentar.'),
('angle','identity','Identitas','Bicara ke kelompok orang yang sangat spesifik ("yang kosannya sempit", "yang kerja shift malam").'),
('angle','utility','Manfaat dulu','Beri tips yang berguna walau orang tidak beli apa pun. Produk muncul belakangan sebagai catatan kaki.'),
('angle','contrarian','Kontra arus','Ambil posisi yang berlawanan dengan opini umum tentang kategori produk ini.'),

-- ── TONE (7)
('tone','deadpan','Datar','Datar, tanpa emoji, tanpa tanda seru. Humor kering kalau ada.'),
('tone','gaul','Gaul','Bahasa sehari-hari Jakarta, singkatan wajar, tanpa berlebihan. Maksimal 1 emoji.'),
('tone','warm_sibling','Kakak yang perhatian','Hangat, menenangkan, seperti kakak yang kasih saran. Tanpa menggurui.'),
('tone','corporate_parody','Parodi korporat','Meniru bahasa kantor secara berlebihan untuk lucu-lucuan, lalu pecah di kalimat terakhir.'),
('tone','chaotic','Chaotic','Kalimat patah-patah, lompat topik sedikit, tapi tetap satu ide utama.'),
('tone','minimal','Minimalis','Kalimat pendek. Banyak ruang kosong. Tanpa emoji. Tanpa hashtag.'),
('tone','enthusiast','Antusias','Antusias tapi spesifik. Antusiasme harus punya alasan konkret, bukan kata sifat kosong.'),

-- ── SELL INTENSITY (3)
('sell_intensity','0','Tanpa jualan','Sama sekali tidak menyebut membeli. Tidak ada CTA. Komentar pertama TIDAK berisi link.'),
('sell_intensity','1','Soft selling','Sebut produk sekali, tanpa mengajak beli. CTA di komentar bersifat informatif ("taruh di komentar").'),
('sell_intensity','2','Direct','Boleh mengajak langsung, tetap tanpa kata "buruan"/"jangan sampai kehabisan".'),

-- ── MEDIA TYPE (3) — images are optional; this is a real arm, not a fallback
('media_type','TEXT','Teks saja','Tanpa gambar. Kalimat pertama harus berdiri sendiri karena tidak ada visual yang menahan scroll. Detail sensorik harus dibawa oleh kata-kata.'),
('media_type','IMAGE','Satu gambar','Satu gambar menyertai post. Jangan mendeskripsikan ulang apa yang sudah terlihat di gambar.'),
('media_type','CAROUSEL','Carousel','Beberapa gambar. Teks boleh mengacu ke urutan, bukan ke satu gambar saja.'),

-- ── LENGTH (3)
('length_band','micro','Mikro','Maksimal 120 karakter.'),
('length_band','mid','Sedang','120-260 karakter.'),
('length_band','long','Panjang','260-480 karakter. Gunakan 2-3 paragraf pendek.');

-- ── BANNED PHRASES (starter list — grow this from the UI every 2 weeks)
INSERT INTO banned_phrases (pattern, reason, scope) VALUES
('^(kalian|kalian pernah|siapa di sini|siapa nih|ada yang)', 'opener klise', 'opener'),
('pernah nggak sih', 'opener klise', 'all'),
('yuk\s', 'kata jualan lemah', 'all'),
('buruan|jangan sampai kehabisan|stok terbatas|limited stock', 'urgency palsu', 'all'),
('bukan cuma .{1,30}, tapi juga', 'paralelisme khas AI', 'all'),
('game[- ]?changer|wajib punya|must have|worth it banget', 'frasa hampa', 'all'),
('di era (digital|modern)|di zaman sekarang', 'pembuka hampa', 'all'),
('mari kita|tak dapat dipungkiri|tidak dapat dipungkiri', 'formal kaku', 'all'),
('semoga bermanfaat|happy shopping|selamat berbelanja', 'penutup klise', 'all'),
('—.*—', 'em-dash berantai', 'all'),
('(#\w+\s*){2,}', 'tumpukan hashtag', 'all'),
('([^\u0000-\u2fff]\s*){3,}', 'baris emoji (regex Postgres, bukan JS)', 'all');

-- ── CTA POOL (the comment). {{link}} is replaced with the tracked short URL.
INSERT INTO cta_variants (text) VALUES
('link-nya di sini ya {{link}}'),
('yang nanya barangnya: {{link}}'),
('taruh di sini biar gak ditanyain satu-satu {{link}}'),
('ini yang aku pakai {{link}}'),
('sebelum lupa {{link}}'),
('buat yang penasaran harganya {{link}}'),
('detail lengkapnya {{link}}'),
('aku beli di sini {{link}}'),
('nih {{link}}'),
('barangnya {{link}}'),
('cek sendiri aja ya {{link}}'),
('yang kemarin nanya di DM, ini {{link}}'),
('kalau mau lihat-lihat dulu {{link}}'),
('spek dan harga ada di sini {{link}}'),
('ada di sini {{link}}');

-- ── SETTINGS
INSERT INTO settings (key, value) VALUES
('posting', '{
  "posts_per_day": 5,
  "slot_hours": [7, 11, 15, 19, 21],
  "jitter_minutes": 18,
  "skip_probability": 0.08,
  "carousel_probability": 0.4,
  "reply_delay_range_sec": [45, 120],
  "daily_zero_sell_posts": 1,
  "image_cooldown_days": 10,
  "redirect_base_url": "https://r.yourdomain.com"
}'),
('bandit', '{
  "epsilon": 0.25,
  "decay": 0.9,
  "cycle_days": 3,
  "min_n_for_combo": 4,
  "winner_top_pct": 0.2,
  "loser_bottom_pct": 0.3,
  "loser_cooldown_days": 9,
  "money_shrinkage_target_orders": 20
}'),
('scoring', '{"w_epm": 0.55, "w_ctr": 0.25, "w_eng": 0.20,
  "eng_weights": {"likes":1, "replies":3, "reposts":5, "quotes":4}}'),
('qa', '{"max_similarity": 0.86, "similarity_lookback": 30, "max_retries": 3,
  "max_chars": 480, "max_emoji": 2, "hashtag_probability": 0.4}'),
('llm', '{"base_url":"https://9router.archxry.space/v1", "api_key":"",
  "model_write":"gemini-2.5-flash", "model_edit":"gpt-4.1-mini",
  "model_embed":"text-embedding-3-small", "model_mine":"gemini-2.5-pro"}');
