const router = require("express").Router();
const { pool } = require("../db");
const { requireAuth, resolveBusinessContext } = require("../middleware/auth");
const { sweepOnce } = require("../services/reminders");

router.use(requireAuth, resolveBusinessContext);

router.get("/", async (req, res) => {
  const { durum } = req.query;
  const values = [req.businessId];
  let where = "business_id = $1";
  if (durum === "okunmadi" || durum === "okundu") {
    values.push(durum);
    where += ` AND durum = $${values.length}`;
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, invoice_id, tur, mesaj, durum, created_at
       FROM notifications
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT 100`,
      values
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "bildirimler alınamadı" });
  }
});

router.get("/unread-count", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM notifications WHERE business_id = $1 AND durum = 'okunmadi'`,
      [req.businessId]
    );
    res.json({ count: rows[0].n });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "okunmamış sayısı alınamadı" });
  }
});

// Dashboard/bell ikonu her açıldığında ya da kullanıcı elle "yenile" dediğinde
// çağrılabilir: sadece bu işletme için taramayı hemen çalıştırır.
router.post("/sweep", async (req, res) => {
  try {
    const result = await sweepOnce(req.businessId);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "hatırlatma taraması başarısız" });
  }
});

router.post("/:id/read", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE notifications SET durum = 'okundu'
       WHERE id = $1 AND business_id = $2
       RETURNING id`,
      [req.params.id, req.businessId]
    );
    if (!rows[0]) return res.status(404).json({ error: "bildirim bulunamadı" });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "bildirim güncellenemedi" });
  }
});

router.post("/read-all", async (req, res) => {
  try {
    await pool.query(
      `UPDATE notifications SET durum = 'okundu' WHERE business_id = $1 AND durum = 'okunmadi'`,
      [req.businessId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "bildirimler güncellenemedi" });
  }
});

module.exports = router;
