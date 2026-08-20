const jwt = require("jsonwebtoken");
const { pool } = require("../db");

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

  if (process.env.DEV_USER_ID && process.env.NODE_ENV !== "production") {
    req.userId = process.env.DEV_USER_ID;
    return next();
  }

  return res.status(401).json({ error: "Token bulunamadı" });
}

async function resolveBusinessContext(req, res, next) {
  const requestedId = req.headers["x-business-id"];

  try {
    if (requestedId) {
      const { rows } = await pool.query(
        `SELECT business_id, role FROM user_businesses
         WHERE user_id = $1 AND business_id = $2 AND status = 'onaylandi'`,
        [req.userId, requestedId]
      );
      if (rows[0]) {
        req.businessId = rows[0].business_id;
        req.businessRole = rows[0].role;
        return next();
      }
      // Eski/silinmiş/henüz onaylanmamış işletme id'si localStorage'da kalmış olabilir; yok sayıp varsayılana düş.
    }

    let { rows } = await pool.query(
      `SELECT business_id, role FROM user_businesses
       WHERE user_id = $1 AND status = 'onaylandi'
       ORDER BY (role = 'sahip') DESC, created_at ASC
       LIMIT 1`,
      [req.userId]
    );

    if (!rows[0]) {
      const ensured = await ensureDefaultBusiness(req.userId);
      if (!ensured) {
        return res.status(400).json({ error: "Kullanıcıya bağlı işletme bulunamadı" });
      }
      rows = [ensured];
    }

    req.businessId = rows[0].business_id;
    req.businessRole = rows[0].role;
    return next();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "İşletme bağlamı çözümlenemedi" });
  }
}

async function ensureDefaultBusiness(userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: existing } = await client.query(
      `SELECT business_id, role FROM user_businesses
       WHERE user_id = $1 AND status = 'onaylandi'
       ORDER BY (role = 'sahip') DESC, created_at ASC
       LIMIT 1`,
      [userId]
    );
    if (existing[0]) {
      await client.query("COMMIT");
      return existing[0];
    }

    const { rows: users } = await client.query(
      `SELECT isletme_adi FROM users WHERE id = $1`,
      [userId]
    );
    const name = (users[0] && users[0].isletme_adi) || "İşletmem";

    const { rows: businessRows } = await client.query(
      `INSERT INTO businesses (isletme_adi) VALUES ($1) RETURNING id`,
      [name]
    );
    const businessId = businessRows[0].id;
    await client.query(
      `INSERT INTO branches (business_id, sube_adi) VALUES ($1, 'Merkez Şube')`,
      [businessId]
    );
    await client.query(
      `INSERT INTO user_businesses (user_id, business_id, role, status) VALUES ($1, $2, 'sahip', 'onaylandi')`,
      [userId, businessId]
    );
    await client.query("COMMIT");
    return { business_id: businessId, role: "sahip" };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { requireAuth, resolveBusinessContext, ensureDefaultBusiness };
