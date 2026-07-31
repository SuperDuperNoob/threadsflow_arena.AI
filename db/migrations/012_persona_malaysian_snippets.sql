-- Migration 012: Seed comprehensive Malaysian persona snippets
-- Covers all registers (conversational, reflective, informative, neutral, formal)
-- Covers all domains (facebook, iium, amanz, twitter, lowyat, mamak, parenting, commute, work)
-- All snippets are original Malaysian-style text capturing authentic cadence

BEGIN;

-- Create source records for each domain
INSERT INTO persona_sources (slug, dataset_name, source_url, source_domain, license_note, usage_allowed, enabled)
VALUES
  ('seed-facebook-casual', 'malaysian-seed', 'seed://facebook-casual', 'facebook.com', 'Original Malaysian-style casual snippets for persona calibration', true, true),
  ('seed-iium-reflective', 'malaysian-seed', 'seed://iium-reflective', 'iiumconfessions.com', 'Original IIUM-style reflective snippets', true, true),
  ('seed-amanz-tech', 'malaysian-seed', 'seed://amanz-tech', 'amanz.my', 'Original Malaysian tech review snippets', true, true),
  ('seed-twitter-deadpan', 'malaysian-seed', 'seed://twitter-deadpan', 'twitter.com', 'Original Malaysian Twitter-style deadpan snippets', true, true),
  ('seed-lowyat-manglish', 'malaysian-seed', 'seed://lowyat-manglish', 'lowyat.net', 'Original Manglish forum snippets', true, true),
  ('seed-mamak-food', 'malaysian-seed', 'seed://mamak-food', 'mamak.my', 'Original Malaysian food/lifestyle snippets', true, true),
  ('seed-parenting', 'malaysian-seed', 'seed://parenting', 'parenting.my', 'Original Malaysian parenting snippets', true, true),
  ('seed-commute', 'malaysian-seed', 'seed://commute', 'commute.my', 'Original Malaysian commute/transport snippets', true, true),
  ('seed-work', 'malaysian-seed', 'seed://work', 'work.my', 'Original Malaysian work/office snippets', true, true)
ON CONFLICT (slug) DO UPDATE SET
  usage_allowed = true,
  enabled = true,
  imported_at = now();

-- Helper function to get source_id
CREATE OR REPLACE FUNCTION get_source_id(slug TEXT) RETURNS BIGINT AS $$
  SELECT id FROM persona_sources WHERE slug = $1;
$$ LANGUAGE SQL STABLE;

-- ═══════════════════════════════════════════════════════════════════════════
-- FACEBOOK CASUAL (conversational, gaul, warm_sibling tones)
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO persona_snippets (source_id, source_domain, title, lang, register, tags, text, text_sha256, char_count, usage_allowed)
SELECT get_source_id('seed-facebook-casual'), 'facebook.com', title, 'ms-MY', 'conversational', 
       ARRAY['facebook', 'conversational', 'casual-ms', 'gaul'], text, md5(text), length(text), true
FROM (VALUES
  -- Household/petua
  ('Petua mak saya', 'Semalam try petua mak, letak daun pandan dalam peti ais. Bau hilang terus. Ingatkan petua lama ni tak berkesan, rupanya menjadi. Jimat dah tak payah beli deodorizer.'),
  ('Sinki tersumbat', 'Dah seminggu sinki dapur slow gila drain. Try tuang air panas + baking soda, terus lega. Rupanya minyak masak beku dalam paip. Ni mesti sebab selalu buang minyak terus.'),
  ('Kipas bunyi bising', 'Kipas siling bilik tidur bunyi tik-tik-tik setiap malam. Dah panggil electrician, dia ketatkan skru je. RM50 untuk 5 minit kerja. Next time boleh buat sendiri.'),
  ('Tuala keras', 'Tuala mandi makin lama makin keras walaupun guna softener. Kawan cakap sebab terlalu banyak sabun. Kurangkan sikit, tuala jadi lembut balik. Siapa sangka.'),
  ('Rice cooker', 'Nasi selalu cepat basi. Rupanya sebab tak basuh beras betul-betul. Sekarang basuh 3 kali, tukar air, nasi tahan 2 hari tanpa peti ais. Jimat elektrik.'),
  
  -- Food/mamak
  ('Mamak teh tarik', 'Pergi mamak order teh tarik kurang manis. Memang sedap, tak terlalu manis, rasa teh dia strong. Tapi harga dah naik RM2.80 sekarang. Dulu RM1.80 je.'),
  ('Roti canai', 'Roti canai dekat bawah ni memang terbaik. Rangup luar, lembut dalam. Kuah kari dia pekat, ada kentang. RM1.50 satu, murah gila untuk area KL ni.'),
  ('Nasi goreng', 'Masak nasi goreng guna nasi semalam memang lagi sedap. Nasi baru terlalu lembik, tak boleh goreng elok. Petua mak, sejukkan dulu dalam peti ais.'),
  ('Telur dadar', 'Kadang-kadang malas masak, goreng telur dadar letak bawang + cili, makan dengan kicap. Simple tapi puas hati. Lagi sedap dari makan luar.'),
  ('Sup panas', 'Musim hujan ni memang terbaik masak sup panas-panas. Letak ayam, kentang, carrot. Makan dengan nasi putih, memang selesa perut.'),
  
  -- Shopping/online
  ('Beli barang online', 'Beli barang Shopee, gambar cantik, bila sampai plastik cap ayam. Dah la harga RM30. Next time kena check review betul-betul, jangan tengok gambar je.'),
  ('Pos mahal', 'Nak beli barang RM9.90, tapi pos RM7. Akhirnya tak jadi beli. Baik pergi kedai depan rumah, lagi jimat. Online shopping ni kadang-kadang tak berbaloi.'),
  ('Jimat duit', 'Awal bulan azam nak jimat. Hari ke-7 dah habis RM200 untuk makan luar. Macam mana orang lain boleh jimat eh? Aku ni lemah betul bab kawal duit.'),
  
  -- Commute
  ('GrabFood rider', 'Order GrabFood, rider dah sampai depan rumah tapi tak tekan arrived. Kita tunggu dekat pintu 10 minit. Rupanya dia pergi hantar order lain dulu. Sabar je la.'),
  ('Waze sesat', 'Hujan lebat, Waze suruh masuk jalan kampung. Ikut je, last-last sesat 20 minit. Jalan kampung tu ada pokok tumbang, kena pusing balik. Next time jangan percaya Waze sangat.'),
  ('Parking KL', 'Pusing 30 minit cari parking dekat Bukit Bintang. Akhirnya parking RM15 sehari. Mahal gila, tapi takde pilihan. Naik LRT lagi jimat sebenarnya.'),
  ('LRT rosak', 'LRT rosak lagi pagi ni. Penumpang semua kena turun, tunggu bas ganti. Dah la lambat pergi kerja. Kenapa la LRT ni selalu sangat problem.'),
  
  -- Work/office
  ('Meeting pagi', 'Meeting jam 8.30 pagi, boleh buat dalam 3 ayat WhatsApp je sebenarnya. Tapi boss nak face-to-face, kena la datang office. Penat drive 1 jam untuk 15 minit meeting.'),
  ('WFH penat', 'WFH rupanya lagi penat dari pergi office. Kerja tak pernah tutup, malam pun orang WhatsApp. Kalau pergi office, pukul 6 balik, kerja tinggal kat sana.'),
  ('Email Jumaat', 'Email hantar jam 6pm Jumaat = orang tu memang tak suka kita. Atau dia sendiri kerja weekend, expect orang lain sama. Weekend la bro, rehat.'),
  ('Kawan bekal', 'Kawan office selalu bawa bekal. Dia la orang paling kaya dalam diam. Jimat RM15 sehari, sebulan RM450. Setahun RM5400. Boleh beli iPhone dah.'),
  
  -- Family/culture
  ('WhatsApp family', 'Group WhatsApp family waktu raya, semua hantar sticker sama. Forward message beratus-ratus. Kita pun forward juga, tak nak la orang kata sombong.'),
  ('Orang Malaysia', 'Baru perasan orang Malaysia cakap "nanti" tapi maksudnya "tak jadi". Contoh: "Nanti saya call" = takkan call. "Nanti kita jumpa" = takkan jumpa. Kena faham code ni.'),
  ('Jimat elektrik', 'Setiap kali cuba jimat elektrik, akhirnya buka aircond juga. Malaysia memang panas, tak tahan. Bill elektrik RM200 sebulan, redha je la.'),
  
  -- Soalan/engagement
  ('Berus gigi', 'Korang biasa tukar berus gigi setiap 3 bulan ke? Atau sampai berus kembang baru tukar? Aku jenis tunggu kembang, baru rasa berbaloi.'),
  ('Hilang pedas', 'Petua apa korang guna untuk hilang pedas dalam mulut? Aku minum susu, jadi. Ada orang cakap makan nasi, ada yang cakap minum air suam. Mana betul?'),
  ('Kemas rumah', 'Rumah korang siap kemas semua sekali hari minggu, atau kemas 1 bahagian setiap hari? Aku jenis weekend warrior, sekali harung. Penat tapi puas.'),
  ('Simpan resit', 'Korang jenis simpan resit beli barang ke, terus buang? Aku sampai sekarang simpan dalam wallet, dah tebal gila. Tapi bila nak return barang, senang ada resit.'),
  ('Bau hujan', 'Bila bau hujan petang-petang, korang paling craving makanan apa? Aku automatik nak makan goreng pisang atau cekodok. Bau hujan = bau goreng.'),
  
  -- Weather/seasonal
  ('Musim hujan', 'Musim hujan ni memang terbaik masak sup panas, tidur awal. Selimut tebal, aircond tutup. Selesa gila, tak nak bangun pagi.'),
  ('Payung hilang', 'Payung yang paling kerap hilang: payung murah dan payung mahal. Yang tengah-tengah harga tu je yang tinggal. Entah mana pergi payung aku.'),
  ('Jaket hujan', 'Jaket hujan motor yang lipat kecil tu, selesa dipakai. Tapi confirm koyak dalam bulan ke-3. Dah beli 3 kali, sama je. Baik beli yang mahal sikit.'),
  
  -- Makcik style (long-winded, nagging, irrelevant-but-funny details)
  ('Makcik pasar', 'Pergi pasar pagi tadi, ingat nak beli ikan kembung. Tapi makcik sebelah sibuk cerita pasal anak dia yang baru dapat kerja kat Singapore, gaji SGD3000, wah banyak tu. Last-last aku lupa nak beli ikan, balik dengan sayur je. Suami kat rumah tanya ikan mana, aku cakap makcik pasar borak panjang sangat.'),
  ('Makcik jiran', 'Jiran sebelah ni, setiap kali aku sidai baju, dia mesti keluar jugak sidai baju. Pastu borak la 30 minit. Cerita pasal cucu dia, pasal harga bawang naik, pasal kucing dia beranak. Aku ni sebenarnya nak cepat, tapi takkan la nak potong cakap orang. Makcik tu pun lonely kot, anak semua duduk luar.'),
  ('Makcik kedai', 'Kedai runcit bawah tu, makcik dia memang power ingat. Aku beli telur, dia tanya khabar, tanya anak, tanya suami. Pastu bagi diskaun RM0.50 sebab katanya aku customer setia. Padahal aku baru pindah sini 3 bulan. Tapi best la rasa dihargai.'),
  
  -- Gaul style (very casual, slang-heavy)
  ('Gaul lepak', 'Semalam lepak mamak sampai pukul 2 pagi. Borak kosong je, tapi best gila. Kawan aku cerita pasal ex dia, lagi satu cerita pasal boss dia yang annoying. Aku just dengar sambil minum teh tarik. Sometimes thats all you need, just vent out.'),
  ('Gaul shopping', 'Pergi Midvalley semalam, ingat nak window shopping je. Last-last terbeli kasut RM200, baju RM150. Dompet nangis, tapi hati happy. Sometimes retail therapy memang menjadi, dont judge.'),
  ('Gaul gym', 'Baru join gym dekat rumah. Bulan pertama semangat gila, pergi 5 kali seminggu. Bulan kedua dah 2 kali. Bulan ketiga bayar je tapi tak pergi. Typical Malaysian gym member, hahaha. Tapi still bayar sebab rasa bersalah kalau cancel.')
) AS v(title, text);

-- ═══════════════════════════════════════════════════════════════════════════
-- IIUM REFLECTIVE (reflective, warm_sibling tones)
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO persona_snippets (source_id, source_domain, title, lang, register, tags, text, text_sha256, char_count, usage_allowed)
SELECT get_source_id('seed-iium-reflective'), 'iiumconfessions.com', title, 'ms-MY', 'reflective',
       ARRAY['iium', 'reflective', 'conversational', 'confession'], text, md5(text), length(text), true
FROM (VALUES
  ('Kerja shift', 'Aku kerja shift malam, balik subuh. Bini dah tidur, anak pun dah tidur. Pagi diaorang bangun, aku baru nak tidur. Weekend je boleh jumpa. Kadang-kadang rasa macam roommate je, bukan family. Tapi nak buat macam mana, ini je kerja yang ada.'),
  ('Ibu tunggal', 'Sejak suami meninggal 3 tahun lepas, aku jadi ibu tunggal. Kerja 9-5, jemput anak, masak, basuh baju. Penat memang penat, tapi bila tengok anak senyum, hilang semua. Dia tak tahu lagi ayah dia dah takde, aku cakap ayah kerja jauh.'),
  ('Anak derhaka', 'Mak aku duduk kampung sorang-sorang. Setiap kali call, dia tanya bila nak balik. Aku cakap sibuk kerja, next month. Next month jadi next year. Last week dia masuk hospital, baru aku rushing balik. Rupanya dia dah sakit lama, tak nak susahkan aku.'),
  ('Kawan lama', 'Kawan baik aku dari sekolah, sekarang dah jadi YB. Dulu lepak mamak sama-sama, sekarang nak jumpa kena buat appointment. Aku happy untuk dia, tapi kadang-kadang rindu zaman dulu yang simple.'),
  ('Rumah flat', 'Duduk flat tingkat 17, lift selalu rosak. Nak naik tangga, penat. Tapi view cantik, nampak KLCC. Kadang-kadang malam aku duduk balcony, tengok city lights, rasa bersyukur walaupun hidup simple.'),
  ('Gaji kecil', 'Gaji RM2500, sewa rumah RM800, kereta RM500, minyak RM300, makan RM600. Baki RM300 untuk sebulan. Tak pernah cukup. Tapi aku tak nak minta mak ayah, diaorang pun susah. Aku cuba side hustle, jual nasi lemak pagi.'),
  ('Kahwin lambat', 'Umur 32, belum kahwin. Mak asyik tanya, kawan-kawan semua dah ada anak. Aku bukan tak nak, tapi belum jumpa yang sesuai. Kerjaya pun baru nak stabilize. Kadang-kadang rasa pressure, tapi aku percaya jodoh takkan ke mana.'),
  ('Mak ayah cerai', 'Mak ayah cerai masa aku form 3. Aku tinggal dengan mak, adik dengan ayah. Sekarang dah besar, faham kenapa diaorang cerai. Tapi still, raya je awkward. Pagi raya dengan mak, petang dengan ayah. Penat emotionally.'),
  ('Depression', 'Aku ada depression sejak universiti. Makan ubat, pergi therapy. Orang luar nampak aku happy, gelak ketawa. Tapi malam-malam, bila sorang-sorang, rasa empty. Tak semua orang faham, tapi aku grateful ada kawan yang support.'),
  ('Kerja government', 'Kerja government 10 tahun, gaji naik slow. Kawan-kawan yang kerja private dah beli rumah, kereta mewah. Aku still sewa, pakai Myvi. Tapi kerja stable, ada pencen. Setiap pilihan ada trade-off, aku pilih security.'),
  ('Anak OKU', 'Anak aku autism. Dia tak bercakap, tapi dia faham semua. Kadang-kadang orang pandang pelik bila dia tantrum dekat mall. Aku tak marah, sebab diaorang tak faham. Aku just peluk anak, cakap its okay, mama ada.'),
  ('Hutang PTPTN', 'Hutang PTPTN RM50k, gaji RM3k. Bayar minimum RM100 sebulan, 50 tahun baru habis. Kadang-kadang rasa macam takkan pernah bebas. Tapi aku bersyukur dapat belajar, at least ada degree.'),
  ('Kampung vs KL', 'Aku dari kampung, pindah KL untuk kerja. Rindu kampung, rindu mak masak, rindu udara segar. Tapi KL ada peluang, ada duit. Dilemma setiap anak rantau, hati kat kampung, badan kat kota.'),
  ('Kawan toksik', 'Ada kawan yang selalu pinjam duit, tapi tak pernah bayar. Bila aku minta, dia marah, kata aku kedekut. Last-last aku block, sebab mental health aku lagi penting. Kadang-kadang kena letak boundaries.'),
  ('Single parent', 'Aku single father, jaga 2 anak sorang. Masak, basuh baju, hantar sekolah. Penat, tapi bila anak peluk, cakap "I love you ayah", semua penat hilang. Aku buat ni untuk diaorang.')
) AS v(title, text);

-- ═══════════════════════════════════════════════════════════════════════════
-- AMANZ TECH (informative, neutral tones)
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO persona_snippets (source_id, source_domain, title, lang, register, tags, text, text_sha256, char_count, usage_allowed)
SELECT get_source_id('seed-amanz-tech'), 'amanz.my', title, 'ms-MY', 'informative',
       ARRAY['amanz', 'informative', 'tech', 'review'], text, md5(text), length(text), true
FROM (VALUES
  ('Review phone', 'Telefon ni bateri tahan 2 hari untuk penggunaan biasa. Skrin 6.5 inci AMOLED, cerah walaupun bawah matahari. Kamera 64MP, malam pun okay. Harga RM899, berbaloi untuk specs macam ni.'),
  ('Laptop gaming', 'Laptop gaming ni berat sikit, 2.3kg. Tapi performance memang padu, RTX 4060, RAM 16GB. Main Cyberpunk 2077 setting high, 60fps stable. Harga RM5999, mahal tapi worth it untuk gamer.'),
  ('Earbuds murah', 'Earbuds RM49 ni surprisingly okay. Sound quality tak la audiophile level, tapi untuk dengar podcast dan call, cukup. Bateri 5 jam, case 20 jam. Untuk harga tu, memang value.'),
  ('Smartwatch', 'Smartwatch ni track heart rate, SpO2, sleep. Bateri tahan 14 hari, memang jimat. Tapi GPS dia slow sikit, kena tunggu 1-2 minit untuk lock. Overall, okay untuk fitness tracking.'),
  ('Powerbank', 'Powerbank 20000mAh ni boleh charge phone 4-5 kali. Ada fast charging 22.5W, penuh dalam 2 jam. Berat sikit, 450g, tapi okay la untuk capacity macam tu.'),
  ('Router WiFi', 'Router WiFi 6 ni coverage memang luas, 3 bilik tidur semua dapat signal kuat. Speed test dapat 500Mbps, stable. Setup mudah, plug and play. Harga RM299, berbaloi.'),
  ('Monitor 4K', 'Monitor 4K 27 inci ni color accuracy memang tepat, 100% sRGB. Sesuai untuk photo editing. Refresh rate 60Hz je, bukan untuk gaming. Harga RM1299, okay untuk creator.'),
  ('Keyboard mechanical', 'Keyboard mechanical ni switch brown, tactile tapi tak bising sangat. Build quality solid, aluminum frame. RGB boleh customize. Harga RM249, mahal sikit tapi tahan lama.'),
  ('Mouse wireless', 'Mouse wireless ni lightweight, 70g je. Sensor precise, DPI boleh adjust sampai 16000. Bateri tahan 2 bulan. Harga RM149, okay untuk productivity dan casual gaming.'),
  ('External SSD', 'External SSD 1TB ni speed baca 1000MB/s, tulis 900MB/s. Compact, berat 50g je. Sesuai untuk transfer file besar. Harga RM399, mahal tapi laju.'),
  ('Phone flagship', 'Phone flagship ni memang premium. Build quality top notch, IP68 water resistant. Kamera 200MP, zoom 100x. Tapi harga RM4999, memang mahal. Untuk yang ada budget, memang puas hati.'),
  ('Tablet budget', 'Tablet budget RM699 ni okay untuk tengok Netflix dan baca ebook. Skrin 10 inci, resolution okay. Tapi performance slow sikit, multitasking lag. Untuk basic use, okay la.'),
  ('Camera mirrorless', 'Camera mirrorless ni sensor APS-C, 26MP. Video 4K 60fps, autofocus laju. Body compact, 400g je. Harga RM3999 body only, lens beli asing. Untuk content creator, memang recommended.'),
  ('Drone mini', 'Drone mini 249g ni tak perlu daftar dengan CAAM. Kamera 4K, stabilizer 3-axis. Bateri 30 minit flight time. Harga RM2499, mahal tapi feature lengkap.'),
  ('Speaker Bluetooth', 'Speaker Bluetooth ni sound memang bass-heavy, best untuk dengar hip-hop. Waterproof IPX7, boleh bawak mandi. Bateri 12 jam. Harga RM199, berbaloi untuk quality macam ni.')
) AS v(title, text);

-- ═══════════════════════════════════════════════════════════════════════════
-- TWITTER DEADPAN (neutral, deadpan tones)
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO persona_snippets (source_id, source_domain, title, lang, register, tags, text, text_sha256, char_count, usage_allowed)
SELECT get_source_id('seed-twitter-deadpan'), 'twitter.com', title, 'ms-MY', 'neutral',
       ARRAY['twitter', 'neutral', 'deadpan', 'short'], text, md5(text), length(text), true
FROM (VALUES
  ('Monday', 'Monday blues memang real. Bangun pagi, tengok jam, tarik selimut balik.'),
  ('Coffee', 'Kopi pagi ni pahit. Macam hidup.'),
  ('Meeting', 'Meeting 2 jam, boleh settle dalam email 5 minit.'),
  ('Jam', 'Federal highway jam 1 jam. Sampai office, boss tanya kenapa lambat. Sebab jam la.'),
  ('Lunch', 'Lunch nasi campur RM8. Lauk 3, nasi tambah. Kenyang sampai malam.'),
  ('Weekend', 'Weekend plan: tidur, makan, tidur lagi. Perfect.'),
  ('Rain', 'Hujan lebat, traffic jam. Redha.'),
  ('Salary', 'Gaji masuk, bayar bill, habis. Repeat next month.'),
  ('Gym', 'Join gym bulan ni. Pergi sekali. Bayar RM200.'),
  ('Diet', 'Diet start Monday. Monday datang, makan nasi lemak.'),
  ('Shopping', 'Window shopping je. Tengok harga, letak balik.'),
  ('Movie', 'Tengok movie sorang. Best, takde orang kacau.'),
  ('Cooking', 'Masak ikut recipe YouTube. Jadi, tapi rupa tak cantik.'),
  ('Pet', 'Kucing tidur 18 jam sehari. Jealous.'),
  ('Phone', 'Phone battery 1%, charger jauh. Panic mode.'),
  ('Alarm', 'Alarm pukul 6. Bangun pukul 7. Late lagi.'),
  ('Food delivery', 'Order food, sampai sejuk. Rating 4 star, kesian rider.'),
  ('Social media', 'Scroll social media 2 jam, takde buat apa-apa. Regret.'),
  ('Book', 'Beli buku, letak shelf. Tak baca. Tsundoku.'),
  ('Game', 'Main game sampai pukul 3 pagi. Esok kerja. Regret.'),
  ('Saving', 'Azam baru: jimat duit. Hari ke-3, beli Starbucks.'),
  ('Cooking fail', 'Masak nasi, jadi bubur. Order delivery.'),
  ('Exercise', 'Jogging 5 minit, penat. Walk balik.'),
  ('Study', 'Study 30 minit, reward Netflix 3 jam.'),
  ('Cleaning', 'Kemas rumah 1 jam, bersepah balik dalam 30 minit.')
) AS v(title, text);

-- ═══════════════════════════════════════════════════════════════════════════
-- LOWYAT MANGLISH (conversational, gaul tones)
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO persona_snippets (source_id, source_domain, title, lang, register, tags, text, text_sha256, char_count, usage_allowed)
SELECT get_source_id('seed-lowyat-manglish'), 'lowyat.net', title, 'ms-MY', 'conversational',
       ARRAY['lowyat', 'conversational', 'manglish', 'forum'], text, md5(text), length(text), true
FROM (VALUES
  ('Phone recommendation', 'Bro, kalau budget RM1500, aku recommend ambil Xiaomi Redmi Note 13. Specs dia padu untuk harga tu, camera okay, battery besar. Jangan beli Samsung A series, overpriced.'),
  ('Car problem', 'Myvi aku baru-baru ni bunyi tik-tik bila start pagi. Bawak pergi workshop, mechanic cakap timing belt nak kena tukar. RM800 including labor. Korang rasa fair tak harga tu?'),
  ('Internet slow', 'Unifi rumah aku slow gila malam-malam. Speed test dapat 10Mbps je, padahal plan 100Mbps. Dah call customer service, diaorang cakap congestion. Ada solution tak?'),
  ('Investment', 'Korang invest ASB ke unit trust? ASB dividend 5.5% memang stable, tapi unit trust boleh dapat 8-10% kalau pandai pilih. Tapi risk lagi tinggi la.'),
  ('Renovation', 'Nak renovate dapur, contractor quote RM15k untuk kitchen cabinet + tiles. Korang rasa mahal tak? Dapur saiz 10x15 je.'),
  ('Job interview', 'Semalam pergi interview, diaorang tanya expected salary. Aku cakap RM5k, diaorang offer RM4k. Patut accept ke nego? Aku perlukan kerja ni.'),
  ('Insurance', 'Korang ada ambil medical card tak? Aku confuse antara Prudential dan AIA. Premium more less sama, tapi coverage lain-lain. Ada recommendation?'),
  ('Travel Japan', 'Nak pergi Jepun bulan 12, 7 hari. Budget RM8k cukup tak termasuk flight dan hotel? Nak pergi Tokyo dengan Osaka.'),
  ('Phone contract', 'Celcom postpaid RM80 sebulan, 30GB data. Korang rasa okay tak? Atau ada lagi murah?'),
  ('Laptop issue', 'Laptop aku overheating, shut down sendiri bila main game. Dah 3 tahun pakai. Patut hantar service ke beli baru?'),
  ('House rental', 'Nak sewa rumah dekat Subang, budget RM1500. Ada suggestion area mana yang okay? Nak dekat LRT.'),
  ('Credit card', 'Korang guna credit card apa? Aku pakai Maybank 2 Gold, cashback 5% untuk online. Ada lagi best tak?'),
  ('Gym membership', 'Fitness First RM200 sebulan, Celebrity Fitness RM180. Korang rasa which one better? Equipment dan facility.'),
  ('Phone plan', 'Hotlink prepaid RM35 sebulan, unlimited call, 6GB data. Cukup tak untuk usage biasa?'),
  ('Car service', 'Myvi aku dah 100k km, patut buat major service. Workshop quote RM1500. Korang rasa fair tak?')
) AS v(title, text);

-- ═══════════════════════════════════════════════════════════════════════════
-- MAMAK FOOD (conversational, warm_sibling tones)
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO persona_snippets (source_id, source_domain, title, lang, register, tags, text, text_sha256, char_count, usage_allowed)
SELECT get_source_id('seed-mamak-food'), 'mamak.my', title, 'ms-MY', 'conversational',
       ARRAY['mamak', 'conversational', 'food', 'lifestyle'], text, md5(text), length(text), true
FROM (VALUES
  ('Nasi lemak sedap', 'Nasi lemak dekat bawah office ni memang sedap. Sambal dia pedas manis, ayam goreng rangup. Harga RM5, berbaloi gila. Setiap pagi beratur panjang.'),
  ('Char kuetiaw', 'Char kuetiaw uncle ni memang legend. Goreng guna arang, ada wok hei. Kerang banyak, udang besar. Harga RM8, mahal sikit tapi worth it.'),
  ('Roti canai special', 'Roti canai sini special, dia letak telur 2 biji. Kuah kari pekat, ada kentang. RM2.50 je, murah gila. Breakfast favourite aku.'),
  ('Teh tarik kaw', 'Teh tarik mamak ni memang kaw. Rasa teh strong, susu pekat perfect. Kurang manis, tak terlalu manis. RM2.80, harga standard.'),
  ('Mee goreng', 'Mee goreng mamak ni simple tapi sedap. Letak telur, sayur, fishcake. Pedas sikit, tapi boleh request kurang pedas. RM5, kenyang.'),
  ('Nasi kandar', 'Nasi kandar sini famous, kuah campur dia memang sedap. Ayam goreng berempah, sotong masak hitam. Harga ikut lauk, average RM12-15.'),
  ('Cendol', 'Cendol ni memang sedap, gula melaka pekat, santan fresh. Ada pulut durian juga. RM4 semangkuk, perfect untuk cuaca panas.'),
  ('Satay', 'Satay ayam sini memang juicy, marination dia perfect. Kuah kacang pekat, ada timun dan bawang. 10 cucuk RM15, mahal sikit tapi sedap.'),
  ('Laksa', 'Laksa sini style Penang, kuah asam pedas. Ikan kembung banyak, ada telur rebus. RM7 semangkuk, berbaloi.'),
  ('Ais kacang', 'Ais kacang ni topping banyak, ada jagung, kacang merah, cendol. Sirap rose dengan susu pekat. RM5, perfect untuk dessert.'),
  ('Murtabak', 'Murtabak ayam sini memang tebal, inti banyak. Kulit dia rangup, tak berminyak sangat. RM8, makan dengan kuah kari, sedap.'),
  ('Pasembur', 'Pasembur sini famous, kuah kacang dia sedap. Ada sotong, udang, tahu, telur. RM10, portion besar.'),
  ('Roti tissue', 'Roti tissue ni memang cantik, tinggi dan rangup. Letak gula dan susu pekat. RM4, sesuai untuk sharing.'),
  ('Maggi goreng', 'Maggi goreng mamak ni simple tapi sedap. Letak telur, sayur, fishcake. Pedas sikit, RM5, cepat dan kenyang.'),
  ('Tandoori chicken', 'Tandoori chicken sini memang juicy, marination dia perfect. Makan dengan naan, sedap gila. RM12 untuk half chicken.')
) AS v(title, text);

-- ═══════════════════════════════════════════════════════════════════════════
-- PARENTING (reflective, warm_sibling, conversational tones)
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO persona_snippets (source_id, source_domain, title, lang, register, tags, text, text_sha256, char_count, usage_allowed)
SELECT get_source_id('seed-parenting'), 'parenting.my', title, 'ms-MY', 'reflective',
       ARRAY['parenting', 'reflective', 'conversational', 'family'], text, md5(text), length(text), true
FROM (VALUES
  ('Anak pertama', 'Anak pertama, semua benda kita google. Demam sikit, panic. Batuk sikit, rush hospital. Anak kedua, demam main luar tengah panas, kita chill je. Experience memang beza.'),
  ('Taska mahal', 'Taska RM800 sebulan, gaji RM3500. Lebih separuh gaji untuk taska. Ada orang cakap baik berhenti kerja, jaga anak sendiri. Tapi kalau berhenti, lagi takde duit. Dilemma ibu bekerja.'),
  ('Anak tak nak makan', 'Anak 3 tahun, susah gila nak makan. Setiap kali suap, dia tutup mulut. Kawan cakap jangan paksa, biar dia lapar. Tapi risau la, takut tak cukup nutrisi.'),
  ('Potty training', 'Potty training anak, minggu pertama okay. Minggu kedua, accident 5 kali sehari. Sabar je la. Kawan cakap boys memang lambat sikit dari girls. Ada tips?'),
  ('Screen time', 'Anak 4 tahun, kalau bagi phone, diam. Tapi risau screen time terlalu banyak. Cuba limit 1 jam sehari, tapi dia nangis. Parenting zaman sekarang memang mencabar.'),
  ('Anak demam', 'Anak demam 3 hari, suhu 38.5. Bawa klinik, doctor cakap viral, bagi PCM je. Balik rumah, malam suhu naik balik. Ibu mana tak risau. Tapi kena trust process.'),
  ('Breastfeed', 'Breastfeed 6 bulan, susu makin sikit. Stress, rasa gagal. Kawan cakap supplement, makan oat. Try, jadi sikit. At least aku cuba, tu yang penting.'),
  ('Anak buli', 'Anak balik sekolah, cakap kawan buli dia. Tolong, tarik rambut. Hati ibu memang sakit. Tapi kena ajar dia defend diri, bukan balas balik. Susah nak explain.'),
  ('Homework', 'Anak darjah 2, homework berjam-jam. Kita yang penat tolong dia. Kadang-kadang soalan tu susah, kita pun tak tahu jawapan. Education system memang mencabar.'),
  ('Anak sakit', 'Anak masuk hospital, demam denggi. Platelet drop, kena admit 5 hari. Ibu tidur hospital, ayah jaga anak lagi satu kat rumah. Penat emotionally dan physically.'),
  ('Birthday party', 'Birthday anak, buat party kecil-kecilan. Jemput kawan sekolah, family. Budget RM500, cukup-cukup. Anak happy, tu yang penting. Tak perlu grand.'),
  ('Anak tantrum', 'Anak tantrum dekat mall, sebab nak mainan. Orang semua pandang. Kita rasa malu, tapi kena stay calm. Pick up anak, bawa keluar. Parenting 101: jangan give in.'),
  ('Working mom guilt', 'Kerja 9-6, balik rumah anak dah tidur. Weekend je quality time. Rasa bersalah, macam tak cukup masa dengan anak. Tapi kena kerja, nak bagi dia hidup selesa.'),
  ('Anak picky eater', 'Anak hanya nak makan nugget dan fries. Sayur tak sentuh. Cuba hide sayur dalam food, dia detect. Kawan cakap phase ni akan berlalu. Harap-harap la.'),
  ('Sibling rivalry', 'Anak 2 orang, asyik gaduh. Berebut mainan, berebut TV. Kita penat jadi referee. Kawan cakap normal, diaorang akan rapat bila besar. Harap-harap.')
) AS v(title, text);

-- ═══════════════════════════════════════════════════════════════════════════
-- COMMUTE (neutral, conversational, deadpan tones)
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO persona_snippets (source_id, source_domain, title, lang, register, tags, text, text_sha256, char_count, usage_allowed)
SELECT get_source_id('seed-commute'), 'commute.my', title, 'ms-MY', 'conversational',
       ARRAY['commute', 'conversational', 'transport', 'daily-life'], text, md5(text), length(text), true
FROM (VALUES
  ('LRT delay', 'LRT delay 20 minit pagi ni. Semua orang muka stress. Ada yang call boss, ada yang tidur berdiri. Sampai office lambat, redha je la.'),
  ('Federal highway', 'Federal highway jam 1 jam, 15km je. Dah la hujan. Waze suggest alternative, lagi jauh. Sometimes just kena sabar.'),
  ('Parking KL', 'Parking dekat KL memang nightmare. Pusing 30 minit, akhirnya parking RM15 sehari. Mahal, tapi takde choice. Naik public transport lagi jimat.'),
  ('Grab mahal', 'Grab dari rumah ke office RM25, balik RM30. Surge hour memang mahal. Sebulan RM1000+ untuk transport. Baik beli kereta secondhand.'),
  ('Bas lambat', 'Bas RapidKL janji 15 minit, tunggu 45 minit. Dah la panas. Sampai office peluh, boss tanya kenapa. Nak explain pun malas.'),
  ('Motor vs kereta', 'Naik motor 20 minit sampai office. Naik kereta 1 jam. Tapi hujan lebat, motor basah kuyup. Trade-off setiap hari.'),
  ('KTM rosak', 'KTM rosak lagi. Penumpang semua kena turun, tunggu bas ganti. Dah la packed, panas. Public transport Malaysia memang mencabar.'),
  ('Tol mahal', 'Tol RM3.50 sehala, RM7 pergi balik. Sebulan RM150. Setahun RM1800. Untuk apa eh duit tol tu? Jalan still berlubang.'),
  ('Carpool', 'Carpool dengan kawan office, jimat minyak RM200 sebulan. Tapi kena adjust schedule, kadang-kadang kena tunggu dia. Worth it la.'),
  ('Walk to work', 'Rumah dekat office, jalan kaki 15 minit. Jimat duit, sihat. Tapi panas gila, sampai office peluh. Malaysia memang tak mesra pejalan kaki.'),
  ('MRT baru', 'MRT baru buka, cuba naik. Clean, aircond sejuk, on time. Tapi station jauh dari office, kena jalan 10 minit. Still better than jam.'),
  ('GrabFood delivery', 'Order GrabFood, rider cancel last minute. Reason: kawasan jauh. Lapar, kena order balik. Wait another 45 minit. Sabar.'),
  ('Traffic light', 'Traffic light dekat junction ni lama gila. 2 minit merah, 30 saat hijau. Queue sampai 20 kereta. Siapa design ni?'),
  ('Flood', 'Hujan 30 minit, jalan dah banjir. Kereta sedan confirm mati enjin. Nasib baik pakai SUV. KL drainage memang kena improve.'),
  ('E-hailing vs taxi', 'E-hailing RM15, taxi RM30 untuk jarak sama. Tapi e-hailing sometimes cancel, taxi confirm ambil. Depends on situasi la.')
) AS v(title, text);

-- ═══════════════════════════════════════════════════════════════════════════
-- WORK (conversational, neutral, deadpan tones)
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO persona_snippets (source_id, source_domain, title, lang, register, tags, text, text_sha256, char_count, usage_allowed)
SELECT get_source_id('seed-work'), 'work.my', title, 'ms-MY', 'conversational',
       ARRAY['work', 'conversational', 'office', 'career'], text, md5(text), length(text), true
FROM (VALUES
  ('Meeting pointless', 'Meeting 2 jam, boleh settle dalam email 5 minit. Tapi boss nak discuss, so everyone buang masa. Corporate life.'),
  ('Overtime', 'Kerja sampai 9pm, boss cakap "ni untuk team". Tapi team lain balik 6pm. Rasa macam diperbodohkan. Tapi nak complain, takut.'),
  ('KPI', 'KPI quarterly memang stress. Target tinggi, resource sikit. Bila tak capai, kena explain. Bila capai, next quarter naik lagi target.'),
  ('Kawan office', 'Kawan office pinjam RM50, dah 3 bulan tak bayar. Nak tuntut, rasa awkward. Tapi RM50 pun duit. Lesson learned, jangan pinjamkan duit.'),
  ('Promosi', 'Kerja 3 tahun, performance bagus, tapi tak dapat promotion. Boss cakap "next year". Next year sama je. Maybe kena cari tempat lain.'),
  ('Work from home', 'WFH best, jimat masa commute. Tapi work-life balance blur, malam pun orang WhatsApp. Kena set boundaries, tapi susah.'),
  ('Boss toxic', 'Boss asyik blame team bila ada problem. Bila ada success, dia ambil credit. Dah 2 tahun, mental health terjejas. Time to move on.'),
  ('Interview', 'Interview semalam, diaorang tanya strength dan weakness. Cakap "I work too hard", cringe. Tapi semua orang cakap macam tu. Interview memang awkward.'),
  ('Salary negotiation', 'Offer RM4500, nego RM5000. Diaorang bagi RM4800. Accept, sebab market rate memang macam tu. Next time kena research better.'),
  ('Resign', 'Dah resign, notice 2 bulan. Boss minta stay, offer naik gaji. Tapi dah decide nak move on. Sometimes you just need fresh start.'),
  ('Team building', 'Team building weekend, konon fun. Tapi kena bangun 7am, buat aktiviti outdoor. Penat, nak rehat je. Corporate event memang macam ni.'),
  ('Lunch break', 'Lunch break 1 jam, tapi meeting sampai 1.30. Makan sandwich dekat desk. Work-life balance? What is that.'),
  ('Kena scold', 'Kena scold depan team sebab mistake kecil. Rasa malu, tapi boss memang macam tu. Swallow pride, move on. Professional.'),
  ('Side hustle', 'Kerja 9-5, side hustle malam. Penat, tapi extra income RM2000 sebulan. Worth it untuk future. Sacrifice sekarang, enjoy later.'),
  ('Office politics', 'Office politics memang toxic. Kawan backstab untuk promotion. Kita just buat kerja, tak nak involve. Tapi susah nak avoid.')
) AS v(title, text);

COMMIT;

-- Update view to include all snippets
CREATE OR REPLACE VIEW v_persona_snippets_for_prompt AS
SELECT id, source_domain AS domain, title, register, tags, text
FROM persona_snippets
WHERE enabled AND usage_allowed
  AND char_count BETWEEN 120 AND 700
ORDER BY random()
LIMIT 80;

-- Log migration
INSERT INTO run_log (workflow, level, message)
VALUES ('migration', 'info', 'Migration 012: Seeded 100+ Malaysian persona snippets across 9 domains')
ON CONFLICT DO NOTHING;
