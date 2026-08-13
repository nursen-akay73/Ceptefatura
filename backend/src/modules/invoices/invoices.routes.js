const express = require("express");
const router = express.Router();

// Yüksel — feature/fatura-modulu
// UI: frontend/pages/invoices.html, invoice-new.html, invoice-template.html

router.get("/", (_req, res) => {
  res.status(501).json({
    todo: "Fatura listesi. Filtre: search, status (Ödendi/Bekliyor/Gecikti), type (E-Fatura/E-Arşiv)",
    fields: ["fatura_no", "cari", "fatura_turu", "tarih", "vade", "tutar", "durum"],
    owner: "Yüksel",
  });
});

router.get("/:id", (_req, res) => {
  res.status(501).json({ todo: "Fatura detay + kalemler", owner: "Yüksel" });
});

router.post("/", (_req, res) => {
  res.status(501).json({
    todo: "Yeni fatura",
    body: {
      cari_id: "",
      fatura_turu: "E-Fatura | E-Arşiv",
      kesim_tarihi: "",
      vade_tarihi: "",
      not: "",
      kalemler: [{ aciklama: "", miktar: 1, birim_fiyat: 0, kdv_orani: 20 }],
    },
    owner: "Yüksel",
  });
});

router.post("/templates", (_req, res) => {
  res.status(501).json({
    todo: "Tekrarlayan fatura şablonu",
    body: {
      cari_id: "",
      fatura_sikligi: "Aylık | Haftalık | 3 Aylık | Yıllık",
      baslangic_tarihi: "",
      aciklama: "",
      miktar: 1,
      birim_fiyat: 0,
      kdv_orani: 20,
    },
    owner: "Yüksel",
  });
});

module.exports = router;
