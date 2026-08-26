const router = require("express").Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pool } = require("../db");
const { requireAuth, ensureDefaultBusiness } = require("../middleware/auth");

// Diğer ön muhasebe/e-fatura uygulamalarında (Paraşüt, Logo, Mikro, Uyumsoft
// vb.) da kayıt sırasında zorunlu tutulan, GİB e-Fatura'nın da satıcı bilgisi
// olarak aradığı temel kimlik bilgileri: vergi no/TCKN, vergi dairesi, adres,
// telefon. Eskiden yalnızca kayıttan sonra Ayarlar sayfasından, isteğe bağlı
// olarak girilebiliyorlardı; artık işletmenin gerçek bir fatura kesebilmesi
// için zaten şart oldukları için en baştan (kayıt formunda) zorunlu.
router.post("/register", async (req, res) => {
  const {
    ad_soyad,
    isletme_adi,
    email,
    sifre,
    sifre_tekrar,
    vergi_no,
    vergi_dairesi,
    telefon,
    adres,
  } = req.body || {};

  if (!ad_soyad || !isletme_adi || !email || !sifre) {
    return res.status(400).json({ error: "ad_soyad, isletme_adi, email, sifre zorunlu" });
  }
  if (sifre_tekrar && sifre !== sifre_tekrar) {
    return res.status(400).json({ error: "şifreler eşleşmiyor" });
  }
  const vergiNoTrimmed = vergi_no ? String(vergi_no).trim() : "";
  if (!vergiNoTrimmed) {
    return res.status(400).json({ error: "vergi no / TC kimlik no zorunlu" });
  }
  if (!/^\d{10,11}$/.test(vergiNoTrimmed)) {
    return res.status(400).json({ error: "vergi no 10 haneli vergi numarası veya 11 haneli TC kimlik no olmalı" });
  }
  const vergiDairesiTrimmed = vergi_dairesi ? String(vergi_dairesi).trim() : "";
  const telefonTrimmed = telefon ? String(telefon).trim() : "";
  const adresTrimmed = adres ? String(adres).trim() : "";
  if (!vergiDairesiTrimmed || !telefonTrimmed || !adresTrimmed) {
    return res.status(400).json({ error: "vergi dairesi, telefon ve adres zorunlu" });
  }

  const client = await pool.connect();
  try {
    const { rows: existingBiz } = await client.query(
      `SELECT id FROM businesses WHERE vergi_no = $1`,
      [vergiNoTrimmed]
    );
    if (existingBiz[0]) {
      return res.status(409).json({
        error: "Bu vergi numarasıyla kayıtlı bir işletme zaten var. Giriş yapmayı deneyin ya da işletme sahibinden Muhasebeci Paneli'nden sizi müşavir olarak eklemesini isteyin.",
      });
    }

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
      `INSERT INTO businesses (isletme_adi, vergi_no, vergi_dairesi, telefon, adres)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [isletme_adi, vergiNoTrimmed, vergiDairesiTrimmed, telefonTrimmed, adresTrimmed]
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
      if (err.constraint === "businesses_vergi_no_key" || /vergi_no/.test(err.detail || "")) {
        return res.status(409).json({ error: "Bu vergi numarasıyla kayıtlı bir işletme zaten var." });
      }
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

router.patch("/me", requireAuth, async (req, res) => {
  const { ad_soyad, email, sifre } = req.body || {};
  const name = String(ad_soyad || "").trim();
  const mail = String(email || "").trim().toLowerCase();
  if (!name || !mail) {
    return res.status(400).json({ error: "ad soyad ve e-posta zorunlu" });
  }
  if (sifre && String(sifre).length < 6) {
    return res.status(400).json({ error: "şifre en az 6 karakter olmalı" });
  }

  try {
    if (sifre) {
      const hash = await bcrypt.hash(String(sifre), 10);
      await pool.query(
        `UPDATE users SET ad_soyad = $1, email = $2, sifre_hash = $3 WHERE id = $4`,
        [name, mail, hash, req.userId]
      );
    } else {
      await pool.query(
        `UPDATE users SET ad_soyad = $1, email = $2 WHERE id = $3`,
        [name, mail, req.userId]
      );
    }
    const { rows } = await pool.query(
      `SELECT id, ad_soyad, isletme_adi, email, created_at FROM users WHERE id = $1`,
      [req.userId]
    );
    if (!rows[0]) return res.status(404).json({ error: "kullanıcı bulunamadı" });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "bu e-posta zaten kayıtlı" });
    }
    console.error(err);
    res.status(500).json({ error: "hesap güncellenemedi" });
  }
});

module.exports = router;
