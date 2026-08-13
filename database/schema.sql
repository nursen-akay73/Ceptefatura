-- Ceptefatura şema taslağı (Nurşen onaylar, backend buna göre yazar)
-- Henüz migration aracı yok; ilk sürüm için referans SQL.

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  ad_soyad      VARCHAR(120) NOT NULL,
  isletme_adi   VARCHAR(160) NOT NULL,
  email         VARCHAR(160) NOT NULL UNIQUE,
  sifre_hash    VARCHAR(255) NOT NULL,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- Yüksel
CREATE TABLE accounts (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  cari_adi    VARCHAR(160) NOT NULL,
  turu        VARCHAR(40),
  vergi_no    VARCHAR(20),
  telefon     VARCHAR(30),
  email       VARCHAR(160),
  bakiye      NUMERIC(12, 2) DEFAULT 0,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- Yüksel
CREATE TABLE invoices (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  account_id      INTEGER NOT NULL REFERENCES accounts(id),
  fatura_no       VARCHAR(40) NOT NULL,
  fatura_turu     VARCHAR(20) NOT NULL, -- E-Fatura | E-Arşiv
  kesim_tarihi    DATE NOT NULL,
  vade_tarihi     DATE,
  fatura_notu     TEXT,
  tutar           NUMERIC(12, 2) NOT NULL DEFAULT 0,
  durum           VARCHAR(20) NOT NULL DEFAULT 'Bekliyor', -- Ödendi | Bekliyor | Gecikti
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE invoice_items (
  id            SERIAL PRIMARY KEY,
  invoice_id    INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  aciklama      VARCHAR(255) NOT NULL,
  miktar        NUMERIC(12, 2) NOT NULL DEFAULT 1,
  birim_fiyat   NUMERIC(12, 2) NOT NULL DEFAULT 0,
  kdv_orani     NUMERIC(5, 2) NOT NULL DEFAULT 20,
  tutar         NUMERIC(12, 2) NOT NULL DEFAULT 0
);

CREATE TABLE invoice_templates (
  id                    SERIAL PRIMARY KEY,
  user_id               INTEGER NOT NULL REFERENCES users(id),
  account_id            INTEGER NOT NULL REFERENCES accounts(id),
  fatura_sikligi        VARCHAR(20) NOT NULL,
  baslangic_tarihi      DATE,
  sonraki_fatura_tarihi DATE,
  aciklama              VARCHAR(255),
  miktar                NUMERIC(12, 2) DEFAULT 1,
  birim_fiyat           NUMERIC(12, 2) DEFAULT 0,
  kdv_orani             NUMERIC(5, 2) DEFAULT 20
);

-- Şeyma
CREATE TABLE expenses (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  tarih       DATE NOT NULL,
  firma       VARCHAR(160),
  kategori    VARCHAR(40) NOT NULL,
  tutar       NUMERIC(12, 2) NOT NULL,
  kaynak      VARCHAR(40) NOT NULL DEFAULT 'Manuel', -- Manuel | OCR | Banka Entegrasyonu
  aciklama    TEXT,
  durum       VARCHAR(40) NOT NULL DEFAULT 'İşlendi', -- İşlendi | Kontrol Bekliyor
  belge_yolu  VARCHAR(255),
  created_at  TIMESTAMP DEFAULT NOW()
);
