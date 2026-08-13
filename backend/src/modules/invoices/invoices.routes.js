const express = require("express");

const pool = require("../../db/pool");
const asyncHandler = require("../../utils/asyncHandler");
const ApiError = require("../../utils/apiError");
const { requireAuth } = require("../../middleware/auth.middleware");
const { calculateTotals } = require("./invoices.calculations");

// Yüksel — feature/fatura-modulu
// UI: frontend/pages/invoices.html, invoice-new.html, invoice-template.html
const router = express.Router();

router.use(requireAuth);

const GECERLI_FATURA_TURU = ["E-Fatura", "E-Arşiv"];
const GECERLI_DURUM = ["Ödendi", "Bekliyor", "Gecikti", "İptal"];
const GECERLI_SIKLIK = ["Haftalık", "Aylık", "3 Aylık", "Yıllık"];

// FTR-<yıl>-<sıra no> formatında, kullanıcı+yıl bazında sıralı fatura no üretir.
// client bir transaction (BEGIN...COMMIT) içindeyken çağrılmalı ki sayaç tutarlı kalsın.
async function generateFaturaNo(client, userId) {
  const year = new Date().getFullYear();
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS adet FROM invoices
     WHERE user_id = $1 AND EXTRACT(YEAR FROM kesim_tarihi) = $2`,
    [userId, year]
  );
  const sira = (rows[0]?.adet || 0) + 1;
  return `FTR-${year}-${String(sira).padStart(4, "0")}`;
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { search, status, type } = req.query;
    const params = [req.user.id];
    let sql = `
      SELECT i.*, a.cari_adi
      FROM invoices i
      JOIN accounts a ON a.id = i.account_id
      WHERE i.user_id = $1`;

    if (search) {
      params.push(`%${search}%`);
      sql += ` AND (i.fatura_no ILIKE $${params.length} OR a.cari_adi ILIKE $${params.length})`;
    }
    if (status) {
      params.push(status);
      sql += ` AND i.durum = $${params.length}`;
    }
    if (type) {
      params.push(type);
      sql += ` AND i.fatura_turu = $${params.length}`;
    }
    sql += " ORDER BY i.kesim_tarihi DESC, i.id DESC";

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  })
);

// Tekrarlayan fatura şablonları — /:id ile çakışmaması için parametreli
// route'lardan (aşağıdaki GET/PUT/DELETE /:id) önce tanımlanmalı.
router.get(
  "/templates",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT t.*, a.cari_adi FROM invoice_templates t
       JOIN accounts a ON a.id = t.account_id
       WHERE t.user_id = $1
       ORDER BY t.sonraki_fatura_tarihi ASC NULLS LAST`,
      [req.user.id]
    );
    res.json(rows);
  })
);

router.post(
  "/templates",
  asyncHandler(async (req, res) => {
    const { cari_id, fatura_sikligi, baslangic_tarihi, aciklama, miktar, birim_fiyat, kdv_orani } =
      req.body || {};

    if (!cari_id || !fatura_sikligi || !baslangic_tarihi || !aciklama) {
      throw new ApiError(
        400,
        "cari_id, fatura_sikligi, baslangic_tarihi, aciklama zorunludur"
      );
    }
    if (!GECERLI_SIKLIK.includes(fatura_sikligi)) {
      throw new ApiError(400, `fatura_sikligi şunlardan biri olmalı: ${GECERLI_SIKLIK.join(", ")}`);
    }

    const cari = await pool.query(
      "SELECT id FROM accounts WHERE id = $1 AND user_id = $2",
      [cari_id, req.user.id]
    );
    if (!cari.rows[0]) throw new ApiError(404, "Cari bulunamadı");

    const { rows } = await pool.query(
      `INSERT INTO invoice_templates
         (user_id, account_id, fatura_sikligi, baslangic_tarihi, sonraki_fatura_tarihi,
          aciklama, miktar, birim_fiyat, kdv_orani)
       VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        req.user.id,
        cari_id,
        fatura_sikligi,
        baslangic_tarihi,
        aciklama,
        miktar || 1,
        birim_fiyat || 0,
        kdv_orani ?? 20,
      ]
    );
    res.status(201).json(rows[0]);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT i.*, a.cari_adi FROM invoices i
       JOIN accounts a ON a.id = i.account_id
       WHERE i.id = $1 AND i.user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) throw new ApiError(404, "Fatura bulunamadı");

    const { rows: items } = await pool.query(
      "SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY id ASC",
      [req.params.id]
    );

    res.json({ ...rows[0], kalemler: items });
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { cari_id, fatura_turu, kesim_tarihi, vade_tarihi, not: faturaNotu, kalemler } =
      req.body || {};

    if (!cari_id || !fatura_turu || !kesim_tarihi || !Array.isArray(kalemler) || kalemler.length === 0) {
      throw new ApiError(400, "cari_id, fatura_turu, kesim_tarihi ve en az bir kalem zorunludur");
    }
    if (!GECERLI_FATURA_TURU.includes(fatura_turu)) {
      throw new ApiError(400, `fatura_turu şunlardan biri olmalı: ${GECERLI_FATURA_TURU.join(", ")}`);
    }

    // Kalem doğrulaması/hesaplaması transaction dışında da yapılabilir ama
    // hata durumunda erken çıkmak için burada tutuyoruz.
    const { items, tutar } = calculateTotals(kalemler);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const cari = await client.query(
        "SELECT id FROM accounts WHERE id = $1 AND user_id = $2",
        [cari_id, req.user.id]
      );
      if (!cari.rows[0]) {
        await client.query("ROLLBACK");
        throw new ApiError(404, "Cari bulunamadı");
      }

      const fatura_no = await generateFaturaNo(client, req.user.id);

      const { rows: invoiceRows } = await client.query(
        `INSERT INTO invoices
           (user_id, account_id, fatura_no, fatura_turu, kesim_tarihi, vade_tarihi, fatura_notu, tutar, durum)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Bekliyor')
         RETURNING *`,
        [
          req.user.id,
          cari_id,
          fatura_no,
          fatura_turu,
          kesim_tarihi,
          vade_tarihi || null,
          faturaNotu || null,
          tutar,
        ]
      );
      const invoice = invoiceRows[0];

      for (const item of items) {
        await client.query(
          `INSERT INTO invoice_items (invoice_id, aciklama, miktar, birim_fiyat, kdv_orani, tutar)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [invoice.id, item.aciklama, item.miktar, item.birim_fiyat, item.kdv_orani, item.tutar]
        );
      }

      await client.query("COMMIT");
      res.status(201).json({ ...invoice, kalemler: items });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  })
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const { vade_tarihi, fatura_notu, durum } = req.body || {};
    if (durum && !GECERLI_DURUM.includes(durum)) {
      throw new ApiError(400, `durum şunlardan biri olmalı: ${GECERLI_DURUM.join(", ")}`);
    }

    const { rows } = await pool.query(
      `UPDATE invoices SET
         vade_tarihi = COALESCE($1, vade_tarihi),
         fatura_notu = COALESCE($2, fatura_notu),
         durum = COALESCE($3, durum)
       WHERE id = $4 AND user_id = $5
       RETURNING *`,
      [vade_tarihi || null, fatura_notu || null, durum || null, req.params.id, req.user.id]
    );
    if (!rows[0]) throw new ApiError(404, "Fatura bulunamadı");
    res.json(rows[0]);
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    // "İptal" = fatura kaydı korunur (finansal geçmiş silinmez), durum İptal'e çekilir.
    const { rows } = await pool.query(
      `UPDATE invoices SET durum = 'İptal' WHERE id = $1 AND user_id = $2 RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) throw new ApiError(404, "Fatura bulunamadı");
    res.json(rows[0]);
  })
);

module.exports = router;
