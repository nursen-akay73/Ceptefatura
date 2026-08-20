const router = require("express").Router();
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");

router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.id, b.isletme_adi, b.vergi_no, b.vergi_dairesi, ub.role, ub.status
       FROM user_businesses ub
       JOIN businesses b ON b.id = ub.business_id
       WHERE ub.user_id = $1
       ORDER BY (ub.status = 'beklemede'), (ub.role = 'sahip') DESC, b.isletme_adi`,
      [req.userId]
    );
    res.json(rows);
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
    console.error(err);
    res.status(500).json({ error: "işletme oluşturulamadı" });
  } finally {
    client.release();
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
