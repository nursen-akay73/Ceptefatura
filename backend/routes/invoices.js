const fs = require("fs");
const router = require("express").Router();
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { upload } = require("../middleware/upload");
const { extractInvoiceFromDocument } = require("../services/documentScan");

const TURLER = ["E-Fatura", "E-Arşiv"];
const DURUMLAR = ["Ödendi", "Bekliyor", "Gecikti"];
const SIKLIKLAR = ["Haftalık", "Aylık", "3 Aylık", "Yıllık"];

router.use(requireAuth);

router.post("/scan", upload.single("belge"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Görüntü/PDF yüklenmedi" });
  }
  try {
    const fileBuffer = fs.readFileSync(req.file.path);
    const extracted = await extractInvoiceFromDocument(fileBuffer, req.file.mimetype);
    res.json(extracted);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || "Görüntü işlenemedi" });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

function kalemTutar(k) {
  const miktar = Number(k.miktar || 1);
  const birim = Number(k.birim_fiyat || 0);
  const kdv = Number(k.kdv_orani ?? 20);
  return Math.round(miktar * birim * (1 + kdv / 100) * 100) / 100;
}

async function nextFaturaNo(userId, db = pool) {
  const year = new Date().getFullYear();
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM invoices
     WHERE user_id = $1 AND EXTRACT(YEAR FROM kesim_tarihi) = $2`,
    [userId, year]
  );
  return `INV-${year}-${String(rows[0].n + 1).padStart(3, "0")}`;
}

router.get("/", async (req, res) => {
  const { search, status, type } = req.query;
  const conditions = ["i.user_id = $1"];
  const values = [req.userId];

  if (status && DURUMLAR.includes(status)) {
    values.push(status);
    conditions.push(`i.durum = $${values.length}`);
  }
  if (type && TURLER.includes(type)) {
    values.push(type);
    conditions.push(`i.fatura_turu = $${values.length}`);
  }
  if (search) {
    values.push(`%${search}%`);
    conditions.push(`(i.fatura_no ILIKE $${values.length} OR a.cari_adi ILIKE $${values.length})`);
  }

  try {
    const { rows } = await pool.query(
      `SELECT i.id, i.fatura_no, a.cari_adi AS cari, i.fatura_turu, i.kesim_tarihi AS tarih,
              i.vade_tarihi AS vade, i.tutar, i.durum
       FROM invoices i
       JOIN accounts a ON a.id = i.account_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY i.kesim_tarihi DESC`,
      values
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "faturalar alınamadı" });
  }
});

router.post("/templates", async (req, res) => {
  const {
    account_id,
    fatura_sikligi,
    baslangic_tarihi,
    sonraki_fatura_tarihi,
    aciklama,
    miktar,
    birim_fiyat,
    kdv_orani,
  } = req.body || {};

  if (!account_id || !fatura_sikligi) {
    return res.status(400).json({ error: "account_id ve fatura_sikligi zorunlu" });
  }
  if (!SIKLIKLAR.includes(fatura_sikligi)) {
    return res.status(400).json({ error: "geçersiz fatura_sikligi" });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO invoice_templates
         (user_id, account_id, fatura_sikligi, baslangic_tarihi, sonraki_fatura_tarihi, aciklama, miktar, birim_fiyat, kdv_orani)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        req.userId,
        account_id,
        fatura_sikligi,
        baslangic_tarihi || null,
        sonraki_fatura_tarihi || null,
        aciklama || null,
        miktar || 1,
        birim_fiyat || 0,
        kdv_orani ?? 20,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "şablon kaydedilemedi" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const { rows: invoices } = await pool.query(
      `SELECT i.*, a.cari_adi
       FROM invoices i
       JOIN accounts a ON a.id = i.account_id
       WHERE i.id = $1 AND i.user_id = $2`,
      [req.params.id, req.userId]
    );
    if (!invoices[0]) {
      return res.status(404).json({ error: "fatura bulunamadı" });
    }
    const { rows: kalemler } = await pool.query(
      `SELECT id, aciklama, miktar, birim_fiyat, kdv_orani, tutar
       FROM invoice_items WHERE invoice_id = $1`,
      [req.params.id]
    );
    res.json({ ...invoices[0], kalemler });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "fatura detayı alınamadı" });
  }
});

router.post("/", async (req, res) => {
  const { account_id, fatura_turu, kesim_tarihi, vade_tarihi, fatura_notu, kalemler } = req.body || {};

  if (!account_id || !fatura_turu || !kesim_tarihi) {
    return res.status(400).json({ error: "account_id, fatura_turu, kesim_tarihi zorunlu" });
  }
  if (!TURLER.includes(fatura_turu)) {
    return res.status(400).json({ error: "geçersiz fatura_turu" });
  }
  if (!Array.isArray(kalemler) || kalemler.length === 0) {
    return res.status(400).json({ error: "en az bir kalem gerekli" });
  }

  const client = await pool.connect();
  try {
    const own = await client.query(
      `SELECT id FROM accounts WHERE id = $1 AND user_id = $2`,
      [account_id, req.userId]
    );
    if (!own.rows[0]) {
      return res.status(400).json({ error: "cari bulunamadı" });
    }

    await client.query("BEGIN");
    const faturaNo = await nextFaturaNo(req.userId, client);
    const items = kalemler.map((k) => ({
      aciklama: k.aciklama || "",
      miktar: Number(k.miktar || 1),
      birim_fiyat: Number(k.birim_fiyat || 0),
      kdv_orani: Number(k.kdv_orani ?? 20),
      tutar: kalemTutar(k),
    }));
    const tutar = items.reduce((s, k) => s + k.tutar, 0);

    const { rows } = await client.query(
      `INSERT INTO invoices
         (user_id, account_id, fatura_no, fatura_turu, kesim_tarihi, vade_tarihi, fatura_notu, tutar)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [req.userId, account_id, faturaNo, fatura_turu, kesim_tarihi, vade_tarihi || null, fatura_notu || null, tutar]
    );
    const invoice = rows[0];

    for (const k of items) {
      await client.query(
        `INSERT INTO invoice_items (invoice_id, aciklama, miktar, birim_fiyat, kdv_orani, tutar)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [invoice.id, k.aciklama, k.miktar, k.birim_fiyat, k.kdv_orani, k.tutar]
      );
    }

    await client.query("COMMIT");
    res.status(201).json({ ...invoice, kalemler: items });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "fatura oluşturulamadı" });
  } finally {
    client.release();
  }
});

module.exports = router;
