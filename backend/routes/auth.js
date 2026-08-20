const router = require("express").Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pool } = require("../db");
const { requireAuth, ensureDefaultBusiness } = require("../middleware/auth");

router.post("/register", async (req, res) => {
  const { ad_soyad, isletme_adi, email, sifre, sifre_tekrar } = req.body || {};

  if (!ad_soyad || !isletme_adi || !email || !sifre) {
    return res.status(400).json({ error: "ad_soyad, isletme_adi, email, sifre zorunlu" });
  }
  if (sifre_tekrar && sifre !== sifre_tekrar) {
    return res.status(400).json({ error: "şifreler eşleşmiyor" });
  }

  const client = await pool.connect();
  try {
    const sifreHash = await bcrypt.hash(sifre, 10);
    await client.query("BEGIN");

    const { rows } = await client.query(
      `INSERT INTO users (ad_soyad, isletme_adi, email, sifre_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, ad_soyad, isletme_adi, email, created_at`,
      [ad_soyad, isletme_adi, email, sifreHash]
    );
    const user = rows[0];

    const { rows: businessRows } = await client.query(
      `INSERT INTO businesses (isletme_adi) VALUES ($1) RETURNING id`,
      [isletme_adi]
    );
    const businessId = businessRows[0].id;

    await client.query(
      `INSERT INTO branches (business_id, sube_adi) VALUES ($1, 'Merkez Şube')`,
      [businessId]
    );
    await client.query(
      `INSERT INTO user_businesses (user_id, business_id, role) VALUES ($1, $2, 'sahip')`,
      [user.id, businessId]
    );

    await client.query("COMMIT");
    res.status(201).json(user);
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") {
      return res.status(409).json({ error: "bu e-posta zaten kayıtlı" });
    }
    console.error(err);
    res.status(500).json({ error: "kayıt başarısız" });
  } finally {
    client.release();
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

    await ensureDefaultBusiness(user.id);
    const { rows: businesses } = await pool.query(
      `SELECT b.id, b.isletme_adi, ub.role
       FROM user_businesses ub
       JOIN businesses b ON b.id = ub.business_id
       WHERE ub.user_id = $1 AND ub.status = 'onaylandi'
       ORDER BY (ub.role = 'sahip') DESC, b.isletme_adi`,
      [user.id]
    );
    const activeBusiness = businesses.find((b) => b.role === "sahip") || businesses[0] || null;

    res.json({
      token,
      user: {
        ...user,
        businesses,
        activeBusinessId: activeBusiness ? activeBusiness.id : null,
      },
    });
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

    await ensureDefaultBusiness(req.userId);
    const { rows: businesses } = await pool.query(
      `SELECT b.id, b.isletme_adi, ub.role
       FROM user_businesses ub
       JOIN businesses b ON b.id = ub.business_id
       WHERE ub.user_id = $1 AND ub.status = 'onaylandi'
       ORDER BY (ub.role = 'sahip') DESC, b.isletme_adi`,
      [req.userId]
    );
    const activeBusiness = businesses.find((b) => b.role === "sahip") || businesses[0] || null;

    res.json({
      ...rows[0],
      businesses,
      activeBusinessId: activeBusiness ? activeBusiness.id : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "kullanıcı alınamadı" });
  }
});

module.exports = router;
