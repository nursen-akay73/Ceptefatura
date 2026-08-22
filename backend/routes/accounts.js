const router = require("express").Router();
const { pool } = require("../db");
const { requireAuth, resolveBusinessContext } = require("../middleware/auth");

router.use(requireAuth, resolveBusinessContext);

router.get("/", async (req, res) => {
  const { search, branch_id } = req.query;
  const values = [req.businessId];
  let where = "business_id = $1";

  if (branch_id) {
    values.push(branch_id);
    where += ` AND branch_id = $${values.length}`;
  }
  if (search) {
    values.push(`%${search}%`);
    where += ` AND (cari_adi ILIKE $${values.length} OR vergi_no ILIKE $${values.length} OR telefon ILIKE $${values.length} OR email ILIKE $${values.length})`;
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, cari_adi, turu, vergi_no, telefon, email, bakiye, branch_id, created_at
       FROM accounts
       WHERE ${where}
       ORDER BY cari_adi`,
      values
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "cariler alınamadı" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, cari_adi, turu, vergi_no, telefon, email, bakiye, branch_id, created_at
       FROM accounts WHERE id = $1 AND business_id = $2`,
      [req.params.id, req.businessId]
    );
    if (!rows[0]) return res.status(404).json({ error: "cari bulunamadı" });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "cari alınamadı" });
  }
});

router.post("/", async (req, res) => {
  const { cari_adi, turu, vergi_no, telefon, email, branch_id } = req.body || {};
  if (!cari_adi) {
    return res.status(400).json({ error: "cari_adi zorunlu" });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO accounts (user_id, business_id, branch_id, cari_adi, turu, vergi_no, telefon, email)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        req.userId,
        req.businessId,
        branch_id || null,
        cari_adi,
        turu || null,
        vergi_no || null,
        telefon || null,
        email || null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "cari oluşturulamadı" });
  }
});

router.patch("/:id", async (req, res) => {
  const { cari_adi, turu, vergi_no, telefon, email, branch_id } = req.body || {};
  if (!cari_adi) {
    return res.status(400).json({ error: "cari_adi zorunlu" });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE accounts
       SET cari_adi = $1, turu = $2, vergi_no = $3, telefon = $4, email = $5, branch_id = $6
       WHERE id = $7 AND business_id = $8
       RETURNING id, cari_adi, turu, vergi_no, telefon, email, bakiye, branch_id, created_at`,
      [
        cari_adi,
        turu || null,
        vergi_no || null,
        telefon || null,
        email || null,
        branch_id || null,
        req.params.id,
        req.businessId,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: "cari bulunamadı" });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "cari güncellenemedi" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM accounts WHERE id = $1 AND business_id = $2 RETURNING id`,
      [req.params.id, req.businessId]
    );
    if (!rows[0]) return res.status(404).json({ error: "cari bulunamadı" });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "23503") {
      // FK violation: bu cariye bağlı faturalar var (invoices.account_id RESTRICT).
      return res.status(409).json({
        error: "Bu cariye ait fatura kayıtları olduğu için silinemedi. Önce ilgili faturaları silin.",
      });
    }
    console.error(err);
    res.status(500).json({ error: "cari silinemedi" });
  }
});

module.exports = router;
