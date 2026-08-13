// TEST-ONLY sahte 'bcryptjs' — GERÇEK BCRYPT DEĞİLDİR.
// Sadece MOCK_DB entegrasyon testinde hash+compare round-trip'ini doğrulamak için
// basit tuzlu SHA-256 kullanır. Üretimde KULLANILMAZ (gerçek bcryptjs paketi kullanılır).
const crypto = require("crypto");

function hash(password, _rounds) {
  return new Promise((resolve) => {
    const salt = crypto.randomBytes(16).toString("hex");
    const digest = crypto.createHash("sha256").update(salt + password).digest("hex");
    resolve(`mockhash$${salt}$${digest}`);
  });
}

function compare(password, hashed) {
  return new Promise((resolve) => {
    if (typeof hashed !== "string" || !hashed.startsWith("mockhash$")) {
      resolve(false);
      return;
    }
    const [, salt, digest] = hashed.split("$");
    const check = crypto.createHash("sha256").update(salt + password).digest("hex");
    resolve(check === digest);
  });
}

module.exports = { hash, compare };
