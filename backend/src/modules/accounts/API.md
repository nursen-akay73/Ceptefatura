# Cari (Accounts) API (Yüksel)

Base: `/api/accounts` — tüm uçlar 🔒 Auth gerekli, sonuçlar `user_id`'ye scoped.

## GET /?search=
200 → cari listesi (ad, vergi no, telefon, email içinde arama)

## GET /:id
200 → tek cari · 404 bulunamadı

## POST /
Body: `{ cari_adi, turu?, vergi_no?, telefon?, email? }`
201 → oluşturulan cari · 400 cari_adi eksik

## PUT /:id
Body: gönderilen alanlar güncellenir (partial update)
200 → güncel cari · 404 bulunamadı

## DELETE /:id
204 → silindi · 404 bulunamadı
