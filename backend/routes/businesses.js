const router = require("express").Router();
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");

router.use(requireAuth);

const LIST_SQL = `SELECT b.id, b.isletme_adi, b.vergi_no, b.vergi_dairesi, b.telefon, b.email, b.sehir, b.adres,
              b.mersis_no, b.ticaret_sicil_no, b.kep_adresi, b.iban,
              ub.role, ub.status
       FROM user_businesses ub
       JOIN businesses b ON b.id = ub.business_id
       WHERE ub.user_id = $1
       ORDER BY (ub.status = 'beklemede'), (ub.role = 'sahip') DESC, b.isletme_adi`;

const LIST_SQL_CORE = `SELECT b.id, b.isletme_adi, b.vergi_no, b.vergi_dairesi,
              ub.role, ub.status
       FROM user_businesses ub
       JOIN businesses b ON b.id = ub.business_id
       WHERE ub.user_id = $1
       ORDER BY (ub.status = 'beklemede'), (ub.role = 'sahip') DESC, b.isletme_adi`;

router.get("/", async (req, res) => {
  try {
    let result;
    try {
      result = await pool.query(LIST_SQL, [req.userId]);
    } catch (err) {
      if (err.code !== "42703") throw err;
      result = await pool.query(LIST_SQL_CORE, [req.userId]);
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "işletmeler alınamadı" });
  }
});

// İşletme sahibinin onayını bekleyen, kendisine gelmiş bağlantı istekleri.
router.get("/requests", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ub.id, ub.business_id, b.isletme_adi, u.ad_soyad, u.email, ub.created_at
       FROM user_businesses ub
       JOIN businesses b ON b.id = ub.business_id
       JOIN users u ON u.id = ub.user_id
       WHERE ub.status = 'beklemede'
         AND ub.business_id IN (
           SELECT business_id FROM user_businesses
           WHERE user_id = $1 AND role = 'sahip' AND status = 'onaylandi'
         )
       ORDER BY ub.created_at`,
      [req.userId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "bekleyen istekler alınamadı" });
  }
});

router.post("/requests/:requestId/approve", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE user_businesses SET status = 'onaylandi'
       WHERE id = $1 AND status = 'beklemede'
         AND business_id IN (
           SELECT business_id FROM user_businesses
           WHERE user_id = $2 AND role = 'sahip' AND status = 'onaylandi'
         )
       RETURNING id`,
      [req.params.requestId, req.userId]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: "İstek bulunamadı" });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "istek onaylanamadı" });
  }
});

router.post("/requests/:requestId/reject", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM user_businesses
       WHERE id = $1 AND status = 'beklemede'
         AND business_id IN (
           SELECT business_id FROM user_businesses
           WHERE user_id = $2 AND role = 'sahip' AND status = 'onaylandi'
         )
       RETURNING id`,
      [req.params.requestId, req.userId]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: "İstek bulunamadı" });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "istek reddedilemedi" });
  }
});

router.post("/", async (req, res) => {
  const { isletme_adi, vergi_no, vergi_dairesi } = req.body || {};
  if (!isletme_adi) {
    return res.status(400).json({ error: "isletme_adi zorunlu" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let business = null;
    if (vergi_no) {
      const { rows: existing } = await client.query(
        `SELECT id, isletme_adi, vergi_no, vergi_dairesi FROM businesses WHERE vergi_no = $1`,
        [vergi_no]
      );
      business = existing[0] || null;
    }

    if (business) {
      // Var olan işletme: veriye hemen erişim vermeden, sahibinin onayını
      // bekleyen bir bağlantı isteği oluştur.
      const { rows: linkRows } = await client.query(
        `INSERT INTO user_businesses (user_id, business_id, role, status)
         VALUES ($1, $2, 'musavir', 'beklemede')
         ON CONFLICT (user_id, business_id) DO NOTHING
         RETURNING id`,
        [req.userId, business.id]
      );
      if (!linkRows[0]) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Bu işletmeyle zaten bir bağlantınız var" });
      }
      await client.query("COMMIT");
      return res.status(202).json({
        ...business,
        role: "musavir",
        status: "beklemede",
        message: "Bağlantı isteği gönderildi. İşletme sahibi onaylayınca verilerine erişebileceksiniz.",
      });
    }

    const { rows: businessRows } = await client.query(
      `INSERT INTO businesses (isletme_adi, vergi_no, vergi_dairesi)
       VALUES ($1, $2, $3)
       RETURNING id, isletme_adi, vergi_no, vergi_dairesi`,
      [isletme_adi, vergi_no || null, vergi_dairesi || null]
    );
    business = businessRows[0];

    await client.query(
      `INSERT INTO branches (business_id, sube_adi) VALUES ($1, 'Merkez Şube')`,
      [business.id]
    );
    await client.query(
      `INSERT INTO user_businesses (user_id, business_id, role, status) VALUES ($1, $2, 'musavir', 'onaylandi')`,
      [req.userId, business.id]
    );

    await client.query("COMMIT");
    res.status(201).json({ ...business, role: "musavir", status: "onaylandi" });
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505" && err.constraint === "businesses_vergi_no_key") {
      // Aynı anda iki istek aynı vergi_no ile yeni işletme açmaya çalıştı (yarış durumu).
      return res.status(409).json({ error: "Bu vergi numarasıyla kayıtlı bir işletme az önce oluşturuldu, tekrar deneyin." });
    }
    console.error(err);
    res.status(500).json({ error: "işletme oluşturulamadı" });
  } finally {
    client.release();
  }
});

// Ayarlar → Firma Profil Bilgileri sekmesinden gerçek işletme kaydını günceller.
// Sadece işletmenin onaylanmış sahibi düzenleyebilir (müşavir salt-okunur görür).
// Diğer ön muhasebe uygulamalarıyla aynı doğrulama: vergi no, vergi dairesi,
// telefon ve adres olmadan gerçek bir fatura kesilemeyeceği için bu alanlar
// da isletme_adi gibi zorunlu (bkz. auth.js -> POST /register). MERSİS no,
// ticaret sicil no, KEP adresi ve IBAN opsiyonel kalıyor: yalnızca sermaye
// şirketlerinde bulunur ya da her firmada zorunlu değildir.
router.patch("/:id", async (req, res) => {
  const {
    isletme_adi,
    vergi_no,
    vergi_dairesi,
    telefon,
    email,
    sehir,
    adres,
    mersis_no,
    ticaret_sicil_no,
    kep_adresi,
    iban,
  } = req.body || {};
  if (!isletme_adi) {
    return res.status(400).json({ error: "isletme_adi zorunlu" });
  }
  const vergiNoTrimmed = vergi_no ? String(vergi_no).trim() : "";
  if (!vergiNoTrimmed) {
    return res.status(400).json({ error: "vergi no / TC kimlik no zorunlu" });
  }
  if (!/^\d{10,11}$/.test(vergiNoTrimmed)) {
    return res.status(400).json({ error: "vergi no 10 haneli vergi numarası veya 11 haneli TC kimlik no olmalı" });
  }
  if (!vergi_dairesi || !String(vergi_dairesi).trim()) {
    return res.status(400).json({ error: "vergi dairesi zorunlu" });
  }
  if (!telefon || !String(telefon).trim()) {
    return res.status(400).json({ error: "telefon zorunlu" });
  }
  if (!adres || !String(adres).trim()) {
    return res.status(400).json({ error: "adres zorunlu" });
  }

  try {
    const own = await pool.query(
      `SELECT 1 FROM user_businesses
       WHERE user_id = $1 AND business_id = $2 AND status = 'onaylandi' AND role = 'sahip'`,
      [req.userId, req.params.id]
    );
    if (!own.rows[0]) {
      return res.status(403).json({ error: "Bu işletmeyi düzenleme yetkiniz yok" });
    }

    if (vergiNoTrimmed) {
      const { rows: existing } = await pool.query(
        `SELECT id FROM businesses WHERE vergi_no = $1 AND id <> $2`,
        [vergiNoTrimmed, req.params.id]
      );
      if (existing[0]) {
        return res.status(409).json({ error: "Bu vergi numarasıyla kayıtlı başka bir işletme zaten var." });
      }
    }

    const { rows } = await pool.query(
      `UPDATE businesses
       SET isletme_adi = $1, vergi_no = $2, vergi_dairesi = $3, telefon = $4, email = $5, sehir = $6, adres = $7,
           mersis_no = $8, ticaret_sicil_no = $9, kep_adresi = $10, iban = $11
       WHERE id = $12
       RETURNING id, isletme_adi, vergi_no, vergi_dairesi, telefon, email, sehir, adres,
                 mersis_no, ticaret_sicil_no, kep_adresi, iban`,
      [
        isletme_adi,
        vergiNoTrimmed,
        String(vergi_dairesi).trim(),
        String(telefon).trim(),
        email || null,
        sehir || null,
        String(adres).trim(),
        mersis_no ? String(mersis_no).trim() : null,
        ticaret_sicil_no ? String(ticaret_sicil_no).trim() : null,
        kep_adresi ? String(kep_adresi).trim() : null,
        iban ? String(iban).trim() : null,
        req.params.id,
      ]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: "işletme bulunamadı" });
    }
    res.json(rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Bu vergi numarasıyla kayıtlı başka bir işletme zaten var." });
    }
    console.error(err);
    res.status(500).json({ error: "işletme güncellenemedi" });
  }
});

router.get("/:id/branches", async (req, res) => {
  try {
    const own = await pool.query(
      `SELECT 1 FROM user_businesses WHERE user_id = $1 AND business_id = $2 AND status = 'onaylandi'`,
      [req.userId, req.params.id]
    );
    if (!own.rows[0]) {
      return res.status(403).json({ error: "Bu işletmeye erişiminiz yok" });
    }

    const { rows } = await pool.query(
      `SELECT id, sube_adi, created_at FROM branches WHERE business_id = $1 ORDER BY created_at`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "şubeler alınamadı" });
  }
});

router.post("/:id/branches", async (req, res) => {
  const { sube_adi } = req.body || {};
  if (!sube_adi) {
    return res.status(400).json({ error: "sube_adi zorunlu" });
  }

  try {
    const own = await pool.query(
      `SELECT 1 FROM user_businesses WHERE user_id = $1 AND business_id = $2 AND status = 'onaylandi'`,
      [req.userId, req.params.id]
    );
    if (!own.rows[0]) {
      return res.status(403).json({ error: "Bu işletmeye erişiminiz yok" });
    }

    const { rows } = await pool.query(
      `INSERT INTO branches (business_id, sube_adi) VALUES ($1, $2) RETURNING *`,
      [req.params.id, sube_adi]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "şube oluşturulamadı" });
  }
});

router.delete("/:id", async (req, res) => {
  const businessId = req.params.id;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: link } = await client.query(
      `DELETE FROM user_businesses
       WHERE user_id = $1 AND business_id = $2
       RETURNING business_id`,
      [req.userId, businessId]
    );
    if (!link[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Bağlı işletme bulunamadı" });
    }

    const { rows: remaining } = await client.query(
      `SELECT 1 FROM user_businesses WHERE business_id = $1 LIMIT 1`,
      [businessId]
    );
    if (!remaining[0]) {
      await client.query(`DELETE FROM businesses WHERE id = $1`, [businessId]);
    }

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "işletme bağlantısı kaldırılamadı" });
  } finally {
    client.release();
  }
});

module.exports = router;
