const express = require("express");
const router = express.Router();

// Yüksel — feature/fatura-modulu (fatura kesmek için cari şart)
// UI: frontend/pages/accounts.html

router.get("/", (_req, res) => {
  res.status(501).json({
    todo: "Cari listesi. Arama: ad, vergi no, telefon, e-posta",
    fields: ["cari_adi", "turu", "vergi_no", "telefon", "email", "bakiye"],
    owner: "Yüksel",
  });
});

router.post("/", (_req, res) => {
  res.status(501).json({
    todo: "Yeni cari",
    body: { cari_adi: "", turu: "", vergi_no: "", telefon: "", email: "" },
    owner: "Yüksel",
  });
});

module.exports = router;
