const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const pool = require("../../db/pool");
const asyncHandler = require("../../utils/asyncHandler");
const ApiError = require("../../utils/apiError");
const { requireAuth } = require("../../middleware/auth.middleware");

// Ortak — Yüksel başlattı (login/register UI: Zeynep)
// Diğer tüm modüller bu router'ın ürettiği JWT'yi kullanır.
const router = express.Router();

const TOKEN_TTL = "7d";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function signToken(user) {
  if (!process.env.JWT_SECRET) {
    throw new ApiError(500, "Sunucu yapılandırma hatası: JWT_SECRET tanımlı değil");
  }
  return jwt.sign(
    { sub: user.id, email: user.email, isletme_adi: user.isletme_adi },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function publicUser(row) {
  return {
    id: row.id,
    ad_soyad: row.ad_soyad,
    isletme_adi: row.isletme_adi,
    email: row.email,
    created_at: row.created_at,
  };
}

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const { ad_soyad, isletme_adi, email, sifre, sifre_tekrar } = req.body || {};

    if (!ad_soyad || !isletme_adi || !email || !sifre || !sifre_tekrar) {
      throw new ApiError(
        400,
        "ad_soyad, isletme_adi, email, sifre, sifre_tekrar alanları zorunludur"
      );
    }
    if (!EMAIL_RE.test(email)) {
      throw new ApiError(400, "Geçerli bir email giriniz");
    }
    if (sifre !== sifre_tekrar) {
      throw new ApiError(400, "sifre ve sifre_tekrar eşleşmiyor");
    }
    if (sifre.length < 6) {
      throw new ApiError(400, "Şifre en az 6 karakter olmalı");
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [
      normalizedEmail,
    ]);
    if (existing.rows.length > 0) {
      throw new ApiError(409, "Bu email ile kayıtlı bir kullanıcı zaten var");
    }

    const sifre_hash = await bcrypt.hash(sifre, 10);

    const { rows } = await pool.query(
      `INSERT INTO users (ad_soyad, isletme_adi, email, sifre_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, ad_soyad, isletme_adi, email, created_at`,
      [ad_soyad, isletme_adi, normalizedEmail, sifre_hash]
    );

    const user = rows[0];
    const token = signToken(user);

    res.status(201).json({ token, user: publicUser(user) });
  })
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, sifre } = req.body || {};
    if (!email || !sifre) {
      throw new ApiError(400, "email ve sifre zorunludur");
    }

    const normalizedEmail = email.toLowerCase().trim();
    const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [
      normalizedEmail,
    ]);
    const user = rows[0];

    // Kullanıcı bulunamasa bile bcrypt.compare çağırmak zamanlama (timing) saldırılarını
    // zorlaştırır; sabit bir hash ile karşılaştırıp aynı hata mesajını döneriz.
    const hashToCompare = user ? user.sifre_hash : "$2a$10$invalidinvalidinvalidinvalidinvalidinva";
    const match = await bcrypt.compare(sifre, hashToCompare);

    if (!user || !match) {
      throw new ApiError(401, "Email veya şifre hatalı");
    }

    const token = signToken(user);
    res.json({ token, user: publicUser(user) });
  })
);

router.post("/logout", requireAuth, (_req, res) => {
  // JWT stateless: sunucuda tutulan bir oturum yok, istemci token'ı silmekle yükümlü.
  res.json({ ok: true });
});

// İşletme (business) yönetimi — kullanıcı profili = işletme bilgisi (schema.sql'de
// ayrı bir businesses tablosu yok, isletme_adi users tablosunda tutuluyor).
router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT id, ad_soyad, isletme_adi, email, created_at FROM users WHERE id = $1",
      [req.user.id]
    );
    if (!rows[0]) throw new ApiError(404, "Kullanıcı bulunamadı");
    res.json(rows[0]);
  })
);

router.put(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { ad_soyad, isletme_adi } = req.body || {};
    if (!ad_soyad && !isletme_adi) {
      throw new ApiError(400, "Güncellenecek en az bir alan gönderin (ad_soyad, isletme_adi)");
    }

    const { rows } = await pool.query(
      `UPDATE users SET
         ad_soyad = COALESCE($1, ad_soyad),
         isletme_adi = COALESCE($2, isletme_adi)
       WHERE id = $3
       RETURNING id, ad_soyad, isletme_adi, email, created_at`,
      [ad_soyad || null, isletme_adi || null, req.user.id]
    );
    res.json(rows[0]);
  })
);

module.exports = router;
