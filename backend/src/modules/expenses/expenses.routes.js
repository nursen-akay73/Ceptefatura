const express = require("express");
const router = express.Router();

// Şeyma — feature/gider-modulu
// UI: frontend/pages/expenses.html, expense-new.html

router.get("/", (_req, res) => {
  res.status(501).json({
    todo: "Gider listesi. Filtre: search, kategori (Ofis/Ulaşım/Hizmet)",
    fields: ["tarih", "firma", "kategori", "tutar", "kaynak", "durum"],
    owner: "Şeyma",
  });
});

router.get("/stats", (_req, res) => {
  res.status(501).json({
    todo: "Toplam gider, bu ay belge, indirilecek KDV, bekleyen belge",
    owner: "Şeyma",
  });
});

router.post("/", (_req, res) => {
  res.status(501).json({
    todo: "Yeni gider (manuel). Belge yükleme ayrı endpoint.",
    body: {
      tarih: "",
      tutar: 0,
      kategori: "Ofis | Ulaşım | Hizmet | Yemek / Temsil | Diğer",
      kaynak: "Manuel | OCR | Banka Entegrasyonu",
      aciklama: "",
      firma: "",
    },
    owner: "Şeyma",
  });
});

router.post("/upload", (_req, res) => {
  res.status(501).json({
    todo: "Fiş/belge yükle. OCR şimdilik mock dönsün.",
    owner: "Şeyma",
  });
});

module.exports = router;
