const router = require("express").Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");

router.post("/register", async (req, res) => {
  const { ad_soyad, isletme_adi, email, sifre, sifre_tekrar } = req.body || {};

  if (!ad_soyad || !isletme_adi || !email || !sifre) {
    return res.status(400).json({ error: "ad_soyad, isletme_adi, email, sifre zorunlu" });
  }
  if (sifre_tekrar && sifre !== sifre_tekrar) {
    return res.status(400).json({ error: "şifreler eşleşmiyor" });
  }

  try {
    const sifreHash = await bcrypt.hash(sifre, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (ad_soyad, isletme_adi, email, sifre_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, ad_soyad, isletme_adi, email, created_at`,
      [ad_soyad, isletme_adi, email, sifreHash]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "bu e-posta zaten kayıtlı" });
    }
    console.error(err);
    res.status(500).json({ error: "kayıt başarısız" });
  }
});

router.post("/login", async (req, res) => {
  const { email, sifre } = req.body || {};
  if (!email || !sifre) {
    return res.status(400).json({ error: "email ve sifre zorunlu" });
  }
  if (!process.env.JWT_SECRET) {
    return res.status(500).json({ error: "JWT_SECRET tanımlı değil" });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, ad_soyad, isletme_adi, email, sifre_hash FROM users WHERE email = $1`,
      [email]
    );
    const user = rows[0];
    if (!user || !user.sifre_hash || !(await bcrypt.compare(sifre, user.sifre_hash))) {
      return res.status(401).json({ error: "e-posta veya şifre hatalı" });
    }

    const token = jwt.sign({ user_id: user.id }, process.env.JWT_SECRET, { expiresIn: "7d" });
    delete user.sifre_hash;
    res.json({ token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "giriş başarısız" });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, ad_soyad, isletme_adi, email, created_at FROM users WHERE id = $1`,
      [req.userId]
    );
    if (!rows[0]) return res.status(404).json({ error: "kullanıcı bulunamadı" });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "kullanıcı alınamadı" });
  }
});

module.exports = router;
