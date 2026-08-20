-- Ceptefatura — Neon PostgreSQL
-- Yüksel: users, accounts, invoices, invoice_items, invoice_templates
-- Şeyma: expenses

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  ad_soyad      varchar(120) not null,
  isletme_adi   varchar(160) not null,
  email         varchar(160) not null unique,
  sifre_hash    varchar(255),
  created_at    timestamptz not null default now()
);

-- İşletme / şube / müşavir-işletme ilişkisi
-- Bir kullanıcı (müşavir) birden fazla işletmeye bağlanabilir; bir işletmenin
-- birden fazla şubesi ve birden fazla kullanıcısı (sahip + müşavir) olabilir.
create table if not exists businesses (
  id            uuid primary key default gen_random_uuid(),
  isletme_adi   varchar(160) not null,
  vergi_no      varchar(20),
  vergi_dairesi varchar(120),
  created_at    timestamptz not null default now()
);

create table if not exists branches (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  sube_adi      varchar(120) not null,
  created_at    timestamptz not null default now()
);

-- status='beklemede': muhasebeci var olan bir işletmeye vergi no ile bağlanmak
-- istediğinde işletme sahibinin onayına düşer; onaylanana kadar bu bağlantı
-- hiçbir veriye erişim vermez (bkz. resolveBusinessContext).
create table if not exists user_businesses (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  business_id   uuid not null references businesses(id) on delete cascade,
  role          varchar(20) not null check (role in ('sahip', 'musavir')),
  status        varchar(20) not null default 'onaylandi'
                check (status in ('beklemede', 'onaylandi', 'reddedildi')),
  created_at    timestamptz not null default now(),
  unique (user_id, business_id)
);

create table if not exists accounts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  business_id uuid references businesses(id) on delete cascade,
  branch_id   uuid references branches(id),
  cari_adi    varchar(160) not null,
  turu        varchar(40),
  vergi_no    varchar(20),
  telefon     varchar(30),
  email       varchar(160),
  bakiye      numeric(12, 2) not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists invoices (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  business_id     uuid references businesses(id) on delete cascade,
  branch_id       uuid references branches(id),
  account_id      uuid not null references accounts(id),
  fatura_no       varchar(40) not null,
  fatura_turu     varchar(20) not null check (fatura_turu in ('E-Fatura', 'E-Arşiv')),
  kesim_tarihi    date not null,
  vade_tarihi     date,
  fatura_notu     text,
  tutar           numeric(12, 2) not null default 0,
  durum           varchar(20) not null default 'Bekliyor'
                  check (durum in ('Ödendi', 'Bekliyor', 'Gecikti')),
  created_at      timestamptz not null default now(),
  unique (user_id, fatura_no)
);

create table if not exists invoice_items (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references invoices(id) on delete cascade,
  aciklama      varchar(255) not null,
  miktar        numeric(12, 2) not null default 1,
  birim_fiyat   numeric(12, 2) not null default 0,
  kdv_orani     numeric(5, 2) not null default 20,
  tutar         numeric(12, 2) not null default 0
);

create table if not exists invoice_templates (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  business_id           uuid references businesses(id) on delete cascade,
  account_id            uuid not null references accounts(id),
  fatura_sikligi        varchar(20) not null
                        check (fatura_sikligi in ('Haftalık', 'Aylık', '3 Aylık', 'Yıllık')),
  baslangic_tarihi      date,
  sonraki_fatura_tarihi date,
  aciklama              varchar(255),
  miktar                numeric(12, 2) default 1,
  birim_fiyat           numeric(12, 2) default 0,
  kdv_orani             numeric(5, 2) default 20,
  created_at            timestamptz not null default now()
);

create table if not exists expenses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  business_id uuid references businesses(id) on delete cascade,
  branch_id   uuid references branches(id),
  tarih       date not null,
  firma       varchar(160),
  kategori    varchar(40) not null
              check (kategori in ('Ofis', 'Ulaşım', 'Hizmet', 'Yemek / Temsil', 'Diğer')),
  tutar       numeric(12, 2) not null,
  kaynak      varchar(40) not null default 'Manuel'
              check (kaynak in ('Manuel', 'OCR', 'Banka Entegrasyonu')),
  aciklama    text,
  durum       varchar(40) not null default 'İşlendi'
              check (durum in ('İşlendi', 'Kontrol Bekliyor')),
  belge_yolu  text,
  created_at  timestamptz not null default now()
);

-- Ödeme sağlayıcısı (iyzico) ile başlatılan/tamamlanan ödeme denemelerinin izlenmesi
create table if not exists payments (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references invoices(id) on delete cascade,
  saglayici   varchar(20) not null default 'iyzico',
  token       varchar(120),
  durum       varchar(20) not null default 'Basladi'
              check (durum in ('Basladi', 'Basarili', 'Basarisiz')),
  tutar       numeric(12, 2),
  ham_yanit   jsonb,
  created_at  timestamptz not null default now()
);

-- Bu dosya daha önce çalıştırılmış olabileceğinden (tablolar zaten var),
-- yeni işletme/şube kolonlarını idempotent şekilde ekliyoruz.
alter table accounts add column if not exists business_id uuid references businesses(id) on delete cascade;
alter table accounts add column if not exists branch_id uuid references branches(id);
alter table invoices add column if not exists business_id uuid references businesses(id) on delete cascade;
alter table invoices add column if not exists branch_id uuid references branches(id);
alter table invoice_templates add column if not exists business_id uuid references businesses(id) on delete cascade;
alter table expenses add column if not exists business_id uuid references businesses(id) on delete cascade;
alter table expenses add column if not exists branch_id uuid references branches(id);
alter table user_businesses add column if not exists status varchar(20) not null default 'onaylandi';
