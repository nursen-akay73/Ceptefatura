const router = require("express").Router();
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");

router.use(requireAuth);

router.get("/", async (req, res) => {
  const search = req.query.search;
  const values = [req.userId];
  let where = "user_id = $1";

  if (search) {
    values.push(`%${search}%`);
    where += ` AND (cari_adi ILIKE $2 OR vergi_no ILIKE $2 OR telefon ILIKE $2 OR email ILIKE $2)`;
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, cari_adi, turu, vergi_no, telefon, email, bakiye, created_at
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

router.post("/", async (req, res) => {
  const { cari_adi, turu, vergi_no, telefon, email } = req.body || {};
  if (!cari_adi) {
    return res.status(400).json({ error: "cari_adi zorunlu" });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO accounts (user_id, cari_adi, turu, vergi_no, telefon, email)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.userId, cari_adi, turu || null, vergi_no || null, telefon || null, email || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "cari oluşturulamadı" });
  }
});

module.exports = router;
