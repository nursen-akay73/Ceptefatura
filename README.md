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

İlk kurulumda her ekip üyesi kendi makinesinde `.env` oluşturmalı. Bu dosya Git'e girmez.

1. Bağımlılıkları kur:

```bash
cd backend
npm install
cp .env.example .env
```

2. `backend/.env` içine şunları yaz:

- `DATABASE_URL` = Neon PostgreSQL connection string
- `JWT_SECRET` = herhangi bir gizli anahtar
- `PORT=3000`

3. Proje kökünden çalıştır:

```bash
npm run dev
```

4. Kontrol et:

- API sağlık: `http://localhost:3000/api/health`
- Site: `http://localhost:3000`

`/api/health` içinde `db.ok: true` görünmüyorsa sorun genelde şunlardan biridir:

- `backend/.env` hiç oluşturulmadı
- `DATABASE_URL` boş / yanlış yapıştırıldı
- Neon tarafında erişim veya bağlantı sorunu var

Not: `backend/.env` dosyası `.gitignore` içinde olduğu için diğer ekip üyeleri `git pull` ile bu dosyayı alamaz. Herkesin kendi `.env` dosyasını elle oluşturması gerekir.
