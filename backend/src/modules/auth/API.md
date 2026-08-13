# Auth API (Yüksel)

Base: `/api/auth`

Token stateless JWT'dir (`Authorization: Bearer <token>`), 7 gün geçerli.

## POST /register
Body: `{ ad_soyad, isletme_adi, email, sifre, sifre_tekrar }`
201 → `{ token, user }` · 400 alan eksik/şifre uyuşmuyor · 409 email zaten kayıtlı

## POST /login
Body: `{ email, sifre }`
200 → `{ token, user }` · 401 email/şifre hatalı

## POST /logout
🔒 Auth gerekli. 200 → `{ ok: true }` (istemci token'ı silmeli)

## GET /me
🔒 Auth gerekli. 200 → `{ id, ad_soyad, isletme_adi, email, created_at }`

## PUT /me
🔒 Auth gerekli. Body: `{ ad_soyad?, isletme_adi? }` (işletme bilgisi güncelleme)
200 → güncel kullanıcı kaydı
