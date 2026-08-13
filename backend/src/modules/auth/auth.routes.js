const express = require("express");
const router = express.Router();

// Ortak — Yüksel ve Şeyma bu endpoint'leri doldurur (login/register UI: Zeynep)
router.post("/register", (_req, res) => {
  res.status(501).json({
    todo: "Kayıt: ad_soyad, isletme_adi, email, sifre, sifre_tekrar",
    owner: "ortak (önce Yüksel başlatsın)",
  });
});

router.post("/login", (_req, res) => {
  res.status(501).json({
    todo: "Giriş: email, sifre — token dön",
    owner: "ortak (önce Yüksel başlatsın)",
  });
});

router.post("/logout", (_req, res) => {
  res.status(501).json({ todo: "Çıkış", owner: "ortak" });
});

module.exports = router;
