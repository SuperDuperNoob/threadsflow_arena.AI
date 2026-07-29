-- Migration 006: Add persona-calibrated Malaysian CTA variants
-- Enhances self-reply CTA diversity with authentic Malaysian social media phrasing

INSERT INTO cta_variants (text) VALUES
('I drop link kat sini tau {{link}}'),
('ramai cakap susah nak cari, ni {{link}}'),
('simpan sini dulu nanti senang nak tengok {{link}}'),
('ni link tempat I ambil hari tu {{link}}'),
('kalau perlukan spec penuh ada kat sini {{link}}'),
('tambah sini buat rujukan {{link}}'),
('I letak link kat sini je tau {{link}}'),
('senang sikit nak belek harga {{link}}'),
('nah link tempat beli {{link}}'),
('drop kat sini untuk sesiapa yang cari {{link}}'),
('I tinggalkan link kat sini tau {{link}}'),
('yang tanya beli kat mana, ni dia {{link}}'),
('pautannya saya drop kat bawah ni {{link}}'),
('rujukan harga dengan seller ada kat sini {{link}}'),
('sini tempat I jumpa promo haritu {{link}}')
ON CONFLICT DO NOTHING;
