const { Pool } = require("pg");

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

if (!hasDatabaseUrl) {
  console.warn("DATABASE_URL tanımsız — Neon connection string'i backend/.env içine yaz");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: hasDatabaseUrl ? { rejectUnauthorized: false } : false,
});

async function checkDbConnection() {
  if (!hasDatabaseUrl) {
    return {
      ok: false,
      reason: "DATABASE_URL eksik",
    };
  }

  try {
    await pool.query("select 1");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error.message,
    };
  }
}

module.exports = {
  pool,
  checkDbConnection,
  hasDatabaseUrl,
};
