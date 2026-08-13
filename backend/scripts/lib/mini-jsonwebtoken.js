// TEST-ONLY sahte 'jsonwebtoken' — HS256 JWT sign/verify'ı Node'un yerleşik
// crypto modülüyle uygular. Üretimde KULLANILMAZ (gerçek jsonwebtoken paketi kullanılır).
const crypto = require("crypto");

function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(str) {
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64").toString("utf8");
}

function parseExpiry(str) {
  const m = /^(\d+)([smhd])$/.exec(String(str));
  if (!m) return 0;
  const mult = { s: 1, m: 60, h: 3600, d: 86400 }[m[2]];
  return Number(m[1]) * mult;
}

function sign(payload, secret, options = {}) {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now };
  if (options.expiresIn) {
    body.exp = now + parseExpiry(options.expiresIn);
  }
  const headerPart = b64url(JSON.stringify(header));
  const payloadPart = b64url(JSON.stringify(body));
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${headerPart}.${payloadPart}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${headerPart}.${payloadPart}.${signature}`;
}

function verify(token, secret) {
  const parts = String(token).split(".");
  if (parts.length !== 3) throw new Error("jwt malformed");
  const [headerPart, payloadPart, signature] = parts;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${headerPart}.${payloadPart}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  if (expected !== signature) throw new Error("invalid signature");
  const payload = JSON.parse(b64urlDecode(payloadPart));
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
    throw new Error("jwt expired");
  }
  return payload;
}

module.exports = { sign, verify };
