const { pool, hasDatabaseUrl } = require("./db");

const STATEMENTS = [
  `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS telefon varchar(30)`,
  `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS email varchar(160)`,
  `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS sehir varchar(80)`,
  `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS adres text`,
  `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS mersis_no varchar(20)`,
  `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS ticaret_sicil_no varchar(60)`,
  `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS kep_adresi varchar(160)`,
  `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS iban varchar(34)`,
  `ALTER TABLE user_businesses ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'onaylandi'`,
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS adres text`,
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS vergi_dairesi varchar(120)`,
  `ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS iskonto_orani numeric(5, 2) NOT NULL DEFAULT 0`,
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
  `CREATE TABLE IF NOT EXISTS invoice_no_counters (
     business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
     yil         integer NOT NULL,
     son_sira    integer NOT NULL DEFAULT 0,
     PRIMARY KEY (business_id, yil)
   )`,
  `INSERT INTO invoice_no_counters (business_id, yil, son_sira)
   SELECT business_id,
          substring(fatura_no from 4 for 4)::int AS yil,
          max(substring(fatura_no from 8 for 9)::int) AS son_sira
   FROM invoices
   WHERE fatura_no ~ '^[a-z]{3}[0-9]{13}$'
   GROUP BY business_id, substring(fatura_no from 4 for 4)::int
   ON CONFLICT (business_id, yil) DO UPDATE
     SET son_sira = GREATEST(invoice_no_counters.son_sira, excluded.son_sira)`,
];

async function ensureSchema() {
  if (!hasDatabaseUrl) return;
  for (const sql of STATEMENTS) {
    await pool.query(sql);
  }
}

module.exports = { ensureSchema };
