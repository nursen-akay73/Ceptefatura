const router = require("express").Router();
const fs = require("fs");
const path = require("path");
const { pool } = require("../db");
const { requireAuth, resolveBusinessContext } = require("../middleware/auth");
const { upload, UPLOAD_DIR } = require("../middleware/upload");
const { extractExpenseFromDocument } = require("../services/documentScan");

const KATEGORILER = ["Ofis", "Ulaşım", "Hizmet", "Yemek / Temsil", "Diğer"];
const KAYNAKLAR = ["Manuel", "OCR", "Banka Entegrasyonu"];

router.use(requireAuth, resolveBusinessContext);

router.post("/scan", upload.single("fis"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Görüntü yüklenmedi" });
  }
  try {
    const fileBuffer = fs.readFileSync(req.file.path);
    const extracted = await extractExpenseFromDocument(fileBuffer, req.file.mimetype);
    res.json(extracted);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || "Görüntü işlenemedi" });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

router.get("/stats", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         COALESCE(SUM(tutar), 0)::numeric AS toplam_gider,
         COUNT(*) FILTER (WHERE tarih >= date_trunc('month', CURRENT_DATE))::int AS bu_ay_belge,
         COALESCE(SUM(tutar) FILTER (WHERE tarih >= date_trunc('month', CURRENT_DATE)) * 20 / 120, 0)::numeric AS indirilecek_kdv,
         COUNT(*) FILTER (WHERE durum = 'Kontrol Bekliyor')::int AS bekleyen_belge
       FROM expenses
       WHERE business_id = $1`,
      [req.businessId]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "İstatistik alınamadı" });
  }
});

router.get("/", async (req, res) => {
  const { search, kategori, branch_id } = req.query;
  const conditions = ["business_id = $1"];
  const values = [req.businessId];

  if (branch_id) {
    values.push(branch_id);
    conditions.push(`branch_id = $${values.length}`);
  }

  if (kategori && KATEGORILER.includes(kategori)) {
    values.push(kategori);
    conditions.push(`kategori = $${values.length}`);
  }
  if (search) {
    values.push(`%${search}%`);
    conditions.push(`(firma ILIKE $${values.length} OR aciklama ILIKE $${values.length})`);
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, tarih, firma, kategori, tutar, kaynak, aciklama, durum, belge_yolu, created_at
       FROM expenses
       WHERE ${conditions.join(" AND ")}
       ORDER BY tarih DESC`,
      values
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Giderler listelenemedi" });
  }
});

function parseBody(req) {
  return {
    tarih: req.body.tarih,
    tutar: req.body.tutar,
    kategori: req.body.kategori,
    kaynak: req.body.kaynak || "Manuel",
    aciklama: req.body.aciklama || null,
    firma: req.body.firma || null,
    branch_id: req.body.branch_id || null,
  };
}

async function createExpense(req, res, belgeYolu) {
  const { tarih, tutar, kategori, kaynak, aciklama, firma, branch_id } = parseBody(req);

  if (!tarih || tutar === undefined || tutar === "" || !kategori) {
    return res.status(400).json({ error: "tarih, tutar ve kategori zorunludur" });
  }
  if (Number(tutar) < 0) {
    return res.status(400).json({ error: "tutar negatif olamaz" });
  }
  if (!KATEGORILER.includes(kategori)) {
    return res.status(400).json({ error: "geçersiz kategori" });
  }
  if (!KAYNAKLAR.includes(kaynak)) {
    return res.status(400).json({ error: "geçersiz kaynak" });
  }

  const durum = kaynak === "OCR" ? "Kontrol Bekliyor" : "İşlendi";

  try {
    const { rows } = await pool.query(
      `INSERT INTO expenses (user_id, business_id, branch_id, tarih, tutar, kategori, kaynak, aciklama, firma, durum, belge_yolu)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [req.userId, req.businessId, branch_id, tarih, tutar, kategori, kaynak, aciklama, firma, durum, belgeYolu]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gider oluşturulamadı" });
  }
}

router.post("/", upload.single("fis"), async (req, res) => {
  const belgeYolu = req.file ? `/uploads/${req.file.filename}` : null;
  return createExpense(req, res, belgeYolu);
});

router.post("/upload", upload.single("fis"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Dosya yok" });
  }
  try {
    const fileBuffer = fs.readFileSync(req.file.path);
    const ocr = await extractExpenseFromDocument(fileBuffer, req.file.mimetype);
    res.status(201).json({
      belge_yolu: `/uploads/${req.file.filename}`,
      ocr,
    });
  } catch (err) {
    res.status(201).json({
      belge_yolu: `/uploads/${req.file.filename}`,
      ocr: null,
      not: err.message || "OCR okunamadı, alanları elle gir",
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, tarih, firma, kategori, tutar, kaynak, aciklama, durum, belge_yolu, branch_id, created_at
       FROM expenses WHERE id = $1 AND business_id = $2`,
      [req.params.id, req.businessId]
    );
    if (!rows[0]) return res.status(404).json({ error: "Gider bulunamadı" });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gider alınamadı" });
  }
});

const DURUMLAR = ["İşlendi", "Kontrol Bekliyor"];

router.patch("/:id", async (req, res) => {
  const { tarih, tutar, kategori, kaynak, aciklama, firma, branch_id, durum } = req.body || {};

  if (!tarih || tutar === undefined || tutar === "" || !kategori) {
    return res.status(400).json({ error: "tarih, tutar ve kategori zorunludur" });
  }
  if (Number(tutar) < 0) {
    return res.status(400).json({ error: "tutar negatif olamaz" });
  }
  if (!KATEGORILER.includes(kategori)) {
    return res.status(400).json({ error: "geçersiz kategori" });
  }
  const kaynakDeger = kaynak || "Manuel";
  if (!KAYNAKLAR.includes(kaynakDeger)) {
    return res.status(400).json({ error: "geçersiz kaynak" });
  }
  const durumDeger = durum || "İşlendi";
  if (!DURUMLAR.includes(durumDeger)) {
    return res.status(400).json({ error: "geçersiz durum" });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE expenses
       SET tarih = $1, tutar = $2, kategori = $3, kaynak = $4, aciklama = $5, firma = $6, branch_id = $7, durum = $8
       WHERE id = $9 AND business_id = $10
       RETURNING id, tarih, firma, kategori, tutar, kaynak, aciklama, durum, belge_yolu, branch_id, created_at`,
      [
        tarih,
        tutar,
        kategori,
        kaynakDeger,
        aciklama || null,
        firma || null,
        branch_id || null,
        durumDeger,
        req.params.id,
        req.businessId,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: "Gider bulunamadı" });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gider güncellenemedi" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM expenses WHERE id = $1 AND business_id = $2 RETURNING belge_yolu`,
      [req.params.id, req.businessId]
    );
    if (!rows[0]) return res.status(404).json({ error: "Gider bulunamadı" });

    // Yüklenmiş fiş/fatura görseli varsa diskten de temizle (best effort).
    const belgeYolu = rows[0].belge_yolu;
    if (belgeYolu) {
      const dosyaAdi = belgeYolu.replace(/^\/uploads\//, "");
      fs.unlink(path.join(UPLOAD_DIR, dosyaAdi), () => {});
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gider silinemedi" });
  }
});

router.use((err, _req, res, _next) => {
  if (err) return res.status(400).json({ error: err.message });
  res.status(500).json({ error: "Yükleme hatası" });
});

module.exports = router;
