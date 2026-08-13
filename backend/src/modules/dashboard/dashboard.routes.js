const express = require("express");
const router = express.Router();

// Ortak özet — Yüksel gelir/tahsilat, Şeyma gider rakamlarını sağlar
// UI: frontend/pages/dashboard.html, reports.html

router.get("/", (_req, res) => {
  res.status(501).json({
    todo: "Dashboard kartları",
    fields: ["toplam_nakit", "bu_ay_gelir", "bu_ay_gider", "bekleyen_tahsilat"],
    owners: { gelir: "Yüksel", gider: "Şeyma" },
  });
});

module.exports = router;
