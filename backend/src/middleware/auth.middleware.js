const jwt = require("jsonwebtoken");

/**
 * Authorization: Bearer <token> başlığını doğrular.
 * Geçerliyse req.user = { id, email, isletme_adi } atar.
 * Tüm korumalı endpoint'ler bu middleware'i kullanır — böylece
 * her kullanıcı sadece kendi verisine erişir (user_id ile scoped sorgular).
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;

  if (!token) {
    return res
      .status(401)
      .json({ error: "Yetkilendirme başlığı eksik (Authorization: Bearer <token>)" });
  }

  if (!process.env.JWT_SECRET) {
    console.error("JWT_SECRET tanımlı değil (.env dosyasını kontrol edin)");
    return res.status(500).json({ error: "Sunucu yapılandırma hatası" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      id: payload.sub,
      email: payload.email,
      isletme_adi: payload.isletme_adi,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Geçersiz veya süresi dolmuş token" });
  }
}

module.exports = { requireAuth };
