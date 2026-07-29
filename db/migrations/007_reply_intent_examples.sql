-- Migration 007: Comment-Intent Seed Examples for L4 Reply Loop
-- Teaches the L4 Reply Loop how to handle 5 core Malaysian user comment intents naturally

CREATE TABLE IF NOT EXISTS reply_intent_examples (
  id                   BIGSERIAL PRIMARY KEY,
  intent               TEXT NOT NULL CHECK (intent IN
                         ('link_inquiry', 'price_inquiry', 'experience_inquiry', 'compatibility_inquiry', 'casual_banter')),
  user_comment_sample  TEXT NOT NULL,
  suggested_reply      TEXT NOT NULL,
  register             TEXT DEFAULT 'conversational',
  created_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reply_intent_examples_intent ON reply_intent_examples (intent);

INSERT INTO reply_intent_examples (intent, user_comment_sample, suggested_reply) VALUES
-- 1. Link / Where to Buy
('link_inquiry', 'Beli kat mana bro?', 'Link tempat I beli ada kat komen paling atas tau.'),
('link_inquiry', 'PM link bang', 'I dah drop link kat komen bawah, boleh tekan terus.'),
('link_inquiry', 'Mana nak cari benda ni?', 'Ada kat link komen bawah ni tau, senang nak tengok.'),
('link_inquiry', 'Ada link Shopee tak?', 'Link Shopee I dah pin/drop kat komen bawah tau.'),

-- 2. Price Inquiry
('price_inquiry', 'Berapa RM ni?', 'Harga dia RM39 masa I cek haritu, link ada kat komen bawah.'),
('price_inquiry', 'Mahal tak?', 'Masa I beli haritu berbaloi jugak harganya, link ada kat komen bawah tau.'),
('price_inquiry', 'Harga berapa bang?', 'Boleh belek harga terkini kat link komen bawah ni.'),

-- 3. User Experience & Durability
('experience_inquiry', 'Tahan lama tak yang ni?', 'So far I guna dah 3 bulan ok je, takde masalah.'),
('experience_inquiry', 'Ok ke brand ni?', 'Bagi I ok sangat untuk guna harian, padu jugak.'),
('experience_inquiry', 'Pernah guna ke?', 'Pernah, haritu beli memang membantu sikit kerja kat rumah.'),

-- 4. Compatibility & Specs
('compatibility_inquiry', 'Boleh guna kat iPhone tak?', 'Boleh je, I test kat iPhone dengan Android dua-dua lepas.'),
('compatibility_inquiry', 'Saiz dia besar mana?', 'Saiz compact je, muat masuk poket atau beg kecil.'),
('compatibility_inquiry', 'Bateri tahan berapa jam?', 'Biasanya tahan 6-8 jam jugak bergantung cara guna.'),

-- 5. Casual Banter
('casual_banter', 'Comel sangat benda ni!', 'Haha kan, tengok pun dah rasa nak simpan satu.'),
('casual_banter', 'Terus teringat mak kat kampung', 'Boleh hadiahkan kat mak nanti, mesti dia suka.'),
('casual_banter', 'Lawak la cara tulis', 'Haha thank you, saja kongsi pengalaman harian.')
ON CONFLICT DO NOTHING;
