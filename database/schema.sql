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

-- fatura_no benzersizliği başlangıçta (user_id, fatura_no) üzerinden tanımlanmıştı.
-- Bir müşavir birden fazla işletme yönetince (bkz. user_businesses), her işletmenin
-- numaralandırması business_id bazında ayrı ayrı 001'den başlıyor (nextFaturaNo);
-- ama eski kısıt user_id bazındaydı. Sonuç: iki farklı işletme aynı anda örn.
-- "INV-2026-002" üretince INSERT unique constraint'e çarpıp "fatura oluşturulamadı"
-- hatası veriyordu. Kısıtı business_id bazına taşıyoruz (idempotent, tekrar
-- çalıştırılabilir).
do $$
declare
  old_constraint text;
begin
  select tc.constraint_name into old_constraint
  from information_schema.table_constraints tc
  where tc.table_name = 'invoices'
    and tc.constraint_type = 'UNIQUE'
    and (
      select array_agg(kcu.column_name::text order by kcu.column_name)
      from information_schema.key_column_usage kcu
      where kcu.constraint_name = tc.constraint_name
    ) = array['fatura_no', 'user_id'];

  if old_constraint is not null then
    execute format('alter table invoices drop constraint %I', old_constraint);
  end if;

  if not exists (
    select 1 from information_schema.table_constraints
    where table_name = 'invoices' and constraint_name = 'invoices_business_id_fatura_no_key'
  ) then
    alter table invoices add constraint invoices_business_id_fatura_no_key unique (business_id, fatura_no);
  end if;
end $$;

-- Ayarlar → Firma Profil Bilgileri sekmesi eskiden statik/demo veriydi;
-- gerçek işletme kaydına bağlamak için eksik kolonları ekliyoruz.
alter table businesses add column if not exists telefon varchar(30);
alter table businesses add column if not exists email varchar(160);
alter table businesses add column if not exists sehir varchar(80);
alter table businesses add column if not exists adres text;

-- Bir vergi numarası (gerçek hayatta) tek bir tüzel/gerçek kişiye ait olur;
-- aynı vergi_no ile ikinci bir işletme kaydı açılamasın. Boş (null) vergi_no'lar
-- bu kısıttan muaf (partial unique index) — henüz vergi no girmemiş işletmeler
-- serbestçe var olabilir.
-- NOT: Bu ALTER, veritabanınızda hâlihazırda aynı vergi_no'ya sahip birden
-- fazla işletme varsa HATA VERİR. Önce şunu çalıştırıp çakışanları bulun:
--   select vergi_no, count(*) from businesses where vergi_no is not null
--   group by vergi_no having count(*) > 1;
-- çıkan satırları elle düzeltin (yanlış kaydı silin/vergi_no'yu temizleyin),
-- sonra bu dosyayı tekrar çalıştırın.
create unique index if not exists businesses_vergi_no_key
  on businesses (vergi_no)
  where vergi_no is not null;

-- Vadesi yaklaşan/geçen faturalar için otomatik hatırlatma bildirimleri.
-- Bir arka plan taraması (bkz. backend/services/reminders.js) her fatura
-- için en fazla bir "vade_yaklasiyor" ve bir "vade_gecti" kaydı üretir
-- (unique (invoice_id, tur)); fatura ödendiğinde ilgili kayıtlar silinir.
create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  invoice_id  uuid references invoices(id) on delete cascade,
  tur         varchar(30) not null check (tur in ('vade_yaklasiyor', 'vade_gecti')),
  mesaj       text not null,
  durum       varchar(20) not null default 'okunmadi'
              check (durum in ('okunmadi', 'okundu')),
  created_at  timestamptz not null default now(),
  unique (invoice_id, tur)
);

create index if not exists notifications_business_durum_idx
  on notifications (business_id, durum, created_at desc);

-- Türkiye e-Fatura numaralandırması (seri kodu + yıl + 9 haneli sıra no,
-- bkz. backend/routes/invoices.js -> nextFaturaNo) için işletme+yıl bazında
-- SADECE ARTAN bir sayaç. Sıra numarasını mevcut faturalar arasındaki en
-- yüksek numaradan türetmek yerine bu tabloyu kullanıyoruz; çünkü en yüksek
-- numaralı fatura silinirse (ör. yanlışlıkla oluşturulmuş bir fatura), "en
-- yüksek numara" yeniden hesaplandığında geriler ve silinen numara bir
-- sonraki faturada tekrar üretilir -- gerçek e-Fatura numaralarında bu kabul
-- edilemez. Sayaç ON CONFLICT ile atomik arttırıldığından eşzamanlı istekler
-- de aynı numarayı iki kez üretemez.
create table if not exists invoice_no_counters (
  business_id uuid not null references businesses(id) on delete cascade,
  yil         integer not null,
  son_sira    integer not null default 0,
  primary key (business_id, yil)
);

-- Bu tablo daha önce yoktu; halihazırda yeni biçimde ("sss" + yıl + 9 haneli
-- sıra, örn. "ylm2026000000002") fatura numarası üretilmiş işletmeler için
-- sayacı, o işletme+yılda görülen en yüksek sıra numarasından başlatıyoruz.
-- Böylece geçiş sırasında zaten var olan bir numarayla çakışan bir numara
-- üretilmez. Idempotent: tekrar çalıştırılırsa sayaç asla geri düşürülmez
-- (GREATEST), sadece ihtiyaç halinde ileri alınır.
insert into invoice_no_counters (business_id, yil, son_sira)
select business_id,
       substring(fatura_no from 4 for 4)::int as yil,
       max(substring(fatura_no from 8 for 9)::int) as son_sira
from invoices
where fatura_no ~ '^[a-z]{3}[0-9]{13}$'
group by business_id, substring(fatura_no from 4 for 4)::int
on conflict (business_id, yil) do update
  set son_sira = greatest(invoice_no_counters.son_sira, excluded.son_sira);

-- e-Fatura görünümlü PDF çıktısında (bkz. backend/services/invoicePdf.js)
-- "EFATURA CARİ" bölümünde cari'nin adresi ve vergi dairesi de gösteriliyor;
-- accounts tablosunda bu iki alan yoktu. Doldurulmazlarsa PDF'te ilgili
-- satır "-" olarak görünür, hata vermez.
alter table accounts add column if not exists adres text;
alter table accounts add column if not exists vergi_dairesi varchar(120);

-- Fatura kalemlerine satır bazında iskonto desteği: kullanıcı bir iskonto
-- oranı (%) girer, tutar bundan türetilir (kdv_orani'nin çalışma şekliyle
-- aynı mantık). İskonto, KDV'den ÖNCE net tutardan düşülür (bkz.
-- backend/routes/invoices.js -> kalemNetIskontolu / kalemTutar).
alter table invoice_items add column if not exists iskonto_orani numeric(5, 2) not null default 0;

-- Diğer ön muhasebe/e-fatura uygulamalarıyla (Paraşüt, Logo, Mikro, Uyumsoft
-- vb.) kıyaslandığında bizde hiç bulunmayan, yaygın olarak istenen firma
-- kimlik bilgileri. Hepsi opsiyonel tutuluyor çünkü MERSİS/ticaret sicil no
-- yalnızca sermaye şirketlerinde (A.Ş., Ltd. Şti.) bulunur, şahıs
-- firmalarında olmayabilir:
--   mersis_no        -> Merkezi Sicil Kayıt Sistemi numarası
--   ticaret_sicil_no -> Ticaret sicil no
--   kep_adresi       -> Kayıtlı elektronik posta (e-tebligat) adresi
--   iban             -> Faturada gösterilecek banka/IBAN bilgisi
alter table businesses add column if not exists mersis_no varchar(20);
alter table businesses add column if not exists ticaret_sicil_no varchar(60);
alter table businesses add column if not exists kep_adresi varchar(160);
alter table businesses add column if not exists iban varchar(34);
