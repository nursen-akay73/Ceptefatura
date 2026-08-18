const jwt = require("jsonwebtoken");

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      req.userId = payload.user_id;
      if (!req.userId) {
        return res.status(401).json({ error: "Token'da user_id yok" });
      }
      return next();
    } catch {
      return res.status(401).json({ error: "Geçersiz veya süresi dolmuş token" });
    }
  }

  if (process.env.DEV_USER_ID) {
    req.userId = process.env.DEV_USER_ID;
    return next();
  }

  return res.status(401).json({ error: "Token bulunamadı" });
}

module.exports = { requireAuth };
