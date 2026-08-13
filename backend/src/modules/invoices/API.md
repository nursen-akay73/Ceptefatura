# Fatura (Invoices) API (Yüksel)

Base: `/api/invoices` — tüm uçlar 🔒 Auth gerekli, sonuçlar `user_id`'ye scoped.
Ara toplam/KDV/genel toplam **backend'de** hesaplanır; frontend sadece gösterir.

## GET /?search=&status=&type=
`status`: Ödendi | Bekliyor | Gecikti | İptal · `type`: E-Fatura | E-Arşiv
200 → fatura listesi (cari_adi dahil)

## GET /:id
200 → fatura + `kalemler` dizisi · 404 bulunamadı

## POST /
Body:
```json
{
  "cari_id": 1,
  "fatura_turu": "E-Fatura",
  "kesim_tarihi": "2026-08-13",
  "vade_tarihi": "2026-09-13",
  "not": "",
  "kalemler": [{ "aciklama": "", "miktar": 1, "birim_fiyat": 0, "kdv_orani": 20 }]
}
```
`fatura_no` otomatik üretilir (`FTR-<yıl>-<sıra no>`). Kalemler ve fatura tek
transaction'da yazılır. 201 → oluşturulan fatura + kalemler · 400 doğrulama
hatası · 404 cari bulunamadı

## PUT /:id
Body: `{ vade_tarihi?, fatura_notu?, durum? }` — durum: Ödendi | Bekliyor | Gecikti | İptal
200 → güncel fatura · 404 bulunamadı

## DELETE /:id
Faturayı silmez, `durum`'u `İptal`'e çeker (finansal kayıt korunur).
200 → güncel fatura · 404 bulunamadı

## GET /templates
200 → tekrarlayan fatura şablonları listesi

## POST /templates
Body: `{ cari_id, fatura_sikligi, baslangic_tarihi, aciklama, miktar?, birim_fiyat?, kdv_orani? }`
`fatura_sikligi`: Haftalık | Aylık | 3 Aylık | Yıllık
201 → oluşturulan şablon · 400 doğrulama hatası · 404 cari bulunamadı
