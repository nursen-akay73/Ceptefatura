# Ceptefatura

Türkiye pazarı için KOBİ/esnaf odaklı, otomasyon ve yapay zekâ destekli
akıllı muhasebe ve e-fatura web platformu (MVP).

## Görev Dağılımı

👉 [PROJE_GOREV_DAGILIMI.md](./PROJE_GOREV_DAGILIMI.md)

| Kişi | Branch | İş |
|---|---|---|
| Zeynep | `feature/fatura-modulu` | Fatura + cari ekranlarını API’ye bağla |
| Ester | `feature/gider-modulu` | Gider + login + dashboard’u API’ye bağla |
| Yüksel | `feature/fatura-modulu` | Fatura, cari, auth API |
| Şeyma | `feature/gider-modulu` | Gider API + belge yükleme |
| Nurşen | `develop` | Veritabanı şeması ve testler |

## Ekip

- Backend: Yüksel, Şeyma
- Frontend/UI: Zeynep, Ester
- Veritabanı & Test: Nurşen

## Branch Kuralı

- `main` → sadece PR ile, direkt push yasak
- `develop` → aktif geliştirme
- `feature/...` → kişisel / modül çalışma dalları

## Klasör Yapısı

```
/frontend    HTML/CSS UI (Zeynep prototipi)
/backend     Express API iskeleti
/database    şema
/tests       test otomasyonu
```

## Çalıştırma

Frontend: `frontend/pages/login.html` dosyasını tarayıcıda aç.

Backend:

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

API: http://localhost:3000/api/health
