const express = require("express");

const pool = require("../../db/pool");
const asyncHandler = require("../../utils/asyncHandler");
const { requireAuth } = require("../../middleware/auth.middleware");

// Ortak özet — Yüksel gelir/tahsilat, Şeyma gider rakamlarını sağlar
// UI: frontend/pages/dashboard.html, reports.html
const router = express.Router();

router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const now = new Date();
    const ay = now.getMonth() + 1;
    const yil = now.getFullYear();

    // Bu ay kesilen faturaların toplamı (iptal edilenler hariç) — "bu ay geliri"
    const { rows: gelirRows } = await pool.query(
      `SELECT COALESCE(SUM(tutar), 0) AS toplam FROM invoices
       WHERE user_id = $1 AND durum != 'İptal'
         AND EXTRACT(MONTH FROM kesim_tarihi) = $2
         AND EXTRACT(YEAR FROM kesim_tarihi) = $3`,
      [req.user.id, ay, yil]
    );

    // Durumu hâlâ "Bekliyor" olan tüm faturaların toplamı — "bekleyen tahsilat" (alacaklar)
    const { rows: bekleyenRows } = await pool.query(
      `SELECT COALESCE(SUM(tutar), 0) AS toplam FROM invoices
       WHERE user_id = $1 AND durum = 'Bekliyor'`,
      [req.user.id]
    );

    // Vadesi en yakın 5 bekleyen fatura — dashboard'daki "vadesi yaklaşan faturalar" listesi için
    const { rows: vadesiYaklasanlar } = await pool.query(
      `SELECT id, fatura_no, vade_tarihi, tutar FROM invoices
       WHERE user_id = $1 AND durum = 'Bekliyor' AND vade_tarihi IS NOT NULL
       ORDER BY vade_tarihi ASC LIMIT 5`,
      [req.user.id]
    );

    res.json({
      bu_ay_gelir: Number(gelirRows[0].toplam),
      bekleyen_tahsilat: Number(bekleyenRows[0].toplam),
      vadesi_yaklasan_faturalar: vadesiYaklasanlar,
      // Aşağıdaki iki alan gider verisine ihtiyaç duyuyor — Şeyma'nın gider modülü
      // tamamlanınca burada hesaplanacak (toplam_nakit = bu_ay_gelir - bu_ay_gider).
      bu_ay_gider: null,
      toplam_nakit: null,
      owners: { gelir: "Yüksel (tamamlandı)", gider: "Şeyma (bekliyor)" },
    });
  })
);

module.exports = router;
