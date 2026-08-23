const { pool, hasDatabaseUrl } = require("./db");

const STATEMENTS = [
  `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS telefon varchar(30)`,
  `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS email varchar(160)`,
  `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS sehir varchar(80)`,
  `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS adres text`,
  `ALTER TABLE user_businesses ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'onaylandi'`,
  `CREATE TABLE IF NOT EXISTS notifications (
     id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
     invoice_id  uuid REFERENCES invoices(id) ON DELETE CASCADE,
     tur         varchar(30) NOT NULL CHECK (tur IN ('vade_yaklasiyor', 'vade_gecti')),
     mesaj       text NOT NULL,
     durum       varchar(20) NOT NULL DEFAULT 'okunmadi'
                 CHECK (durum IN ('okunmadi', 'okundu')),
     created_at  timestamptz NOT NULL DEFAULT now(),
     UNIQUE (invoice_id, tur)
   )`,
];

async function ensureSchema() {
  if (!hasDatabaseUrl) return;
  for (const sql of STATEMENTS) {
    await pool.query(sql);
  }
}

module.exports = { ensureSchema };
