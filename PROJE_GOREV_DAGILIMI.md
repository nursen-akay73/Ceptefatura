# Görev ve Branch Dağılımı

`main` iskeleti hazır: `frontend/` Zeynep’in UI’si, `backend/` API taslağı (501 stub).
Kimse `main`’e direkt push atmasın. İş bitince PR → `develop`.

## Kim hangi branch?

| Kişi | Rol | Branch | Klasör |
|---|---|---|---|
| **Zeynep** | Frontend — fatura ekranları | `feature/fatura-modulu` | `frontend/pages/invoices.html`, `invoice-new.html`, `invoice-template.html`, `accounts.html` |
| **Ester** | Frontend — gider + ortak ekranlar | `feature/gider-modulu` | `frontend/pages/expenses.html`, `expense-new.html`, `dashboard.html`, `reports.html`, `login.html`, `register.html` |
| **Yüksel** | Backend — fatura + cari | `feature/fatura-modulu` | `backend/src/modules/invoices`, `accounts`, `auth` |
| **Şeyma** | Backend — gider | `feature/gider-modulu` | `backend/src/modules/expenses` |
| **Nurşen** | DB şema + test | `develop` | `database/`, `tests/` |

Aynı modülde FE ve BE aynı branch’te çalışır (çakışma az: Zeynep HTML, Yüksel JS API).

## Başlamadan

```bash
git fetch origin
git checkout feature/fatura-modulu   # Yüksel / Zeynep
git merge origin/main

git checkout feature/gider-modulu    # Şeyma / Ester
git merge origin/main
```

## Yüksel ne yazacak?

- `POST /api/auth/register` ve `POST /api/auth/login` (ekibi kilitlemesin diye önce bu)
- Cari CRUD — `GET/POST /api/accounts`
- Fatura listesi / detay / oluştur — `GET/POST /api/invoices`
- Fatura kalemleri, KDV, fatura no üretimi
- Tekrarlayan şablon — `POST /api/invoices/templates`
- Dashboard’a gelir + bekleyen tahsilat

UI alanları: fatura no, cari, tür (E-Fatura/E-Arşiv), kesim/vade tarihi, tutar, durum (Ödendi/Bekliyor/Gecikti).

## Şeyma ne yazacak?

- Gider listesi + filtre — `GET /api/expenses`
- Yeni gider — `POST /api/expenses`
- İstatistik — `GET /api/expenses/stats` (toplam, bu ay belge, indirilecek KDV, bekleyen)
- Fiş yükleme — `POST /api/expenses/upload`
- OCR **şimdilik sahte** (yüklenen belgeden örnek JSON dön)
- Dashboard’a `bu_ay_gider`

UI alanları: tarih, firma, kategori, tutar, kaynak (Manuel/OCR/Banka), durum.

## Zeynep ne yapacak?

Sahte (`data-demo-form`) fatura/cari formlarını Yüksel’in API’sine bağla.
Liste sayfalarındaki sabit tabloları `fetch` ile doldur.

## Ester ne yapacak?

Login/register + gider formlarını Şeyma’nın API’sine bağla.
Dashboard ve rapor kartlarını gerçek sayılarla doldur.

## Nurşen

`database/schema.sql` netleşsin, test klasörüne health + CRUD senaryoları yazılsın.
Tablo değişikliği PR’siz yapılmasın.
