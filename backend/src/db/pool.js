let pool;

if (process.env.MOCK_DB === "true") {
  // Gerçek PostgreSQL olmadan test etmek için bellek içi sahte veritabanı.
  // SADECE geliştirme/test amaçlıdır — üretimde KULLANILMAMALIDIR.
  // Bkz. scripts/test-api.js ve README'deki "PostgreSQL olmadan test" bölümü.
  console.log("⚠️  MOCK_DB=true — gerçek Postgres yerine bellek içi sahte veritabanı kullanılıyor.");
  const { createMockPool } = require("./mockPool");
  pool = createMockPool();
} else {
  const { Pool } = require("pg");
  // DATABASE_URL örn: postgres://kullanici:sifre@localhost:5432/ceptefatura
  // .env dosyasında tanımlanmalı (bkz. .env.example)
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
  pool.on("error", (err) => {
    console.error("Beklenmeyen veritabanı havuzu hatası:", err);
  });
}

module.exports = pool;
