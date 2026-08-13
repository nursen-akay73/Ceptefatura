# Dashboard API (ortak — gelir kısmı Yüksel, gider kısmı Şeyma)

Base: `/api/dashboard` — 🔒 Auth gerekli.

## GET /
200 →
```json
{
  "bu_ay_gelir": 1320,
  "bekleyen_tahsilat": 1320,
  "vadesi_yaklasan_faturalar": [{ "id": 3, "fatura_no": "FTR-2026-0003", "vade_tarihi": "...", "tutar": 1200 }],
  "bu_ay_gider": null,
  "toplam_nakit": null,
  "owners": { "gelir": "Yüksel (tamamlandı)", "gider": "Şeyma (bekliyor)" }
}
```

`bu_ay_gelir`: bu ay kesilen, iptal edilmemiş faturaların toplamı.
`bekleyen_tahsilat`: durumu "Bekliyor" olan tüm faturaların toplamı (alacaklar).
`vadesi_yaklasan_faturalar`: vade tarihi girilmiş, "Bekliyor" durumundaki en yakın 5 fatura.

`bu_ay_gider` ve `toplam_nakit` şu an `null` — Şeyma'nın gider modülü tamamlanınca
(`toplam_nakit = bu_ay_gelir - bu_ay_gider`) buraya eklenmesi gerekiyor.
