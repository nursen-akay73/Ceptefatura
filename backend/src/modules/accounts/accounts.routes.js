const express = require("express");

const pool = require("../../db/pool");
const asyncHandler = require("../../utils/asyncHandler");
const ApiError = require("../../utils/apiError");
const { requireAuth } = require("../../middleware/auth.middleware");

// Yüksel — feature/fatura-modulu (fatura kesmek için cari şart)
// UI: frontend/pages/accounts.html
const router = express.Router();

router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { search } = req.query;
    const params = [req.user.id];
    let sql = "SELECT * FROM accounts WHERE user_id = $1";

    if (search) {
      params.push(`%${search}%`);
      sql += ` AND (cari_adi ILIKE $${params.length} OR vergi_no ILIKE $${params.length} OR telefon ILIKE $${params.length} OR email ILIKE $${params.length})`;
    }
    sql += " ORDER BY cari_adi ASC";

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT * FROM accounts WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user.id]
    );
    if (!rows[0]) throw new ApiError(404, "Cari bulunamadı");
    res.json(rows[0]);
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { cari_adi, turu, vergi_no, telefon, email } = req.body || {};
    if (!cari_adi) {
      throw new ApiError(400, "cari_adi zorunludur");
    }

    const { rows } = await pool.query(
      `INSERT INTO accounts (user_id, cari_adi, turu, vergi_no, telefon, email)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.user.id, cari_adi, turu || null, vergi_no || null, telefon || null, email || null]
    );
    res.status(201).json(rows[0]);
  })
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const { cari_adi, turu, vergi_no, telefon, email } = req.body || {};

    const { rows } = await pool.query(
      `UPDATE accounts SET
         cari_adi = COALESCE($1, cari_adi),
         turu = COALESCE($2, turu),
         vergi_no = COALESCE($3, vergi_no),
         telefon = COALESCE($4, telefon),
         email = COALESCE($5, email)
       WHERE id = $6 AND user_id = $7
       RETURNING *`,
      [
        cari_adi || null,
        turu || null,
        vergi_no || null,
        telefon || null,
        email || null,
        req.params.id,
        req.user.id,
      ]
    );
    if (!rows[0]) throw new ApiError(404, "Cari bulunamadı");
    res.json(rows[0]);
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const { rowCount } = await pool.query(
      "DELETE FROM accounts WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user.id]
    );
    if (!rowCount) throw new ApiError(404, "Cari bulunamadı");
    res.status(204).send();
  })
);

module.exports = router;
