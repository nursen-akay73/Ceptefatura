# Ceptefatura

KOBİ/esnaf için muhasebe ve e-fatura MVP.

Backend: **Node.js / Express** (Python yok).  
Veritabanı: Neon PostgreSQL.

## Kim ne yapar

| Kişi | Branch | Dosya |
|---|---|---|
| Yüksel | `feature/fatura-modulu` | `backend/routes/auth.js`, `accounts.js`, `invoices.js` |
| Şeyma | `feature/gider-modulu` | `backend/routes/expenses.js` |
| Zeynep | `feature/fatura-modulu` | fatura + cari ekranları |
| Ester | `feature/gider-modulu` | login, gider, dashboard |
| Nurşen | `develop` | `database/schema.sql` |

`main`’e push yok. PR → `develop`.

## Klasörler

```
frontend/
backend/
  index.js
  db.js                 Neon bağlantısı
  middleware/auth.js    JWT
  routes/auth.js        kayıt / giriş
  routes/accounts.js    cariler
  routes/invoices.js    faturalar
  routes/expenses.js    giderler
database/schema.sql
```

## Çalıştırma

Proje kökünden:

```bash
cd backend
cp .env.example .env
```

`.env` içine Neon `DATABASE_URL` ve bir `JWT_SECRET` yaz. İlk seferde `cd backend && npm install`.

Sonra kök klasörde:

```bash
npm run dev
```

API: http://localhost:3000/api/health  
Site: http://localhost:3000
