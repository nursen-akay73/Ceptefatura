const fs = require("fs");
const router = require("express").Router();
const Iyzipay = require("iyzipay");
const { pool } = require("../db");
const { requireAuth, resolveBusinessContext } = require("../middleware/auth");
const { upload } = require("../middleware/upload");
const { extractInvoiceFromDocument } = require("../services/documentScan");
const { getClient: getIyzicoClient, isConfigured: isIyzicoConfigured } = require("../lib/iyzico");

const TURLER = ["E-Fatura", "E-Arşiv"];
const DURUMLAR = ["Ödendi", "Bekliyor", "Gecikti"];
const SIKLIKLAR = ["Haftalık", "Aylık", "3 Aylık", "Yıllık"];

// iyzico'nun tarayıcı üzerinden yaptığı yönlendirmede JWT gelmez,
// bu yüzden requireAuth'tan ÖNCE tanımlanmalı.
router.post("/:id/payment-callback", async (req, res) => {
  const token = req.body && req.body.token;
  const FRONTEND_REDIRECT = "/pages/invoices.html";
  if (!token) {
    return res.redirect(FRONTEND_REDIRECT + "?payment=failed");
  }

  try {
    // Token'ın gerçekten BU faturaya ait, henüz sonuçlanmamış bir ödeme
    // denemesine bağlı olduğunu doğrula — aksi halde başka bir ödemenin
    // token'ı ile keyfi bir fatura "Ödendi" işaretlenebilir.
    const { rows: paymentRows } = await pool.query(
      `SELECT id, invoice_id, tutar FROM payments
       WHERE token = $1 AND invoice_id = $2 AND durum = 'Basladi'`,
      [token, req.params.id]
    );
    const payment = paymentRows[0];
    if (!payment) {
      return res.redirect(FRONTEND_REDIRECT + "?payment=failed");
    }

    const iyzipay = getIyzicoClient();
    iyzipay.checkoutForm.retrieve({ locale: "tr", token }, async (err, result) => {
      const paidAmount = result ? Number(result.paidPrice ?? result.price) : NaN;
      const amountOk = !Number.isNaN(paidAmount) && Math.abs(paidAmount - Number(payment.tutar)) < 0.01;

      if (err || !result || result.paymentStatus !== "SUCCESS" || !amountOk) {
        await pool.query(
          `UPDATE payments SET durum = 'Basarisiz', ham_yanit = $1 WHERE id = $2`,
          [JSON.stringify(result || { error: err && err.message }), payment.id]
        );
        return res.redirect(FRONTEND_REDIRECT + "?payment=failed");
      }

      try {
        await pool.query(
          `UPDATE payments SET durum = 'Basarili', ham_yanit = $1 WHERE id = $2`,
          [JSON.stringify(result), payment.id]
        );
        await pool.query(`UPDATE invoices SET durum = 'Ödendi' WHERE id = $1`, [payment.invoice_id]);
        res.redirect(FRONTEND_REDIRECT + "?payment=success");
      } catch (dbErr) {
        console.error(dbErr);
        res.redirect(FRONTEND_REDIRECT + "?payment=failed");
      }
    });
  } catch (err) {
    console.error(err);
    res.redirect(FRONTEND_REDIRECT + "?payment=failed");
  }
});

router.use(requireAuth, resolveBusinessContext);

router.post("/scan", upload.single("belge"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Görüntü yüklenmedi" });
  }
  try {
    const fileBuffer = fs.readFileSync(req.file.path);
    const extracted = await extractInvoiceFromDocument(fileBuffer, req.file.mimetype);
    res.json(extracted);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || "Görüntü işlenemedi" });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

function kalemTutar(k) {
  const miktar = Number(k.miktar || 1);
  const birim = Number(k.birim_fiyat || 0);
  const kdv = Number(k.kdv_orani ?? 20);
  return Math.round(miktar * birim * (1 + kdv / 100) * 100) / 100;
}

async function nextFaturaNo(businessId, db = pool) {
  const year = new Date().getFullYear();
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM invoices
     WHERE business_id = $1 AND EXTRACT(YEAR FROM kesim_tarihi) = $2`,
    [businessId, year]
  );
  return `INV-${year}-${String(rows[0].n + 1).padStart(3, "0")}`;
}

router.get("/", async (req, res) => {
  const { search, status, type, branch_id } = req.query;
  const conditions = ["i.business_id = $1"];
  const values = [req.businessId];

  if (branch_id) {
    values.push(branch_id);
    conditions.push(`i.branch_id = $${values.length}`);
  }
  if (status && DURUMLAR.includes(status)) {
    values.push(status);
    conditions.push(`i.durum = $${values.length}`);
  }
  if (type && TURLER.includes(type)) {
    values.push(type);
    conditions.push(`i.fatura_turu = $${values.length}`);
  }
  if (search) {
    values.push(`%${search}%`);
    conditions.push(`(i.fatura_no ILIKE $${values.length} OR a.cari_adi ILIKE $${values.length})`);
  }

  try {
    const { rows } = await pool.query(
      `SELECT i.id, i.fatura_no, a.cari_adi AS cari, i.fatura_turu, i.kesim_tarihi AS tarih,
              i.vade_tarihi AS vade, i.tutar, i.durum, i.branch_id, b.sube_adi
       FROM invoices i
       JOIN accounts a ON a.id = i.account_id
       LEFT JOIN branches b ON b.id = i.branch_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY i.kesim_tarihi DESC`,
      values
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "faturalar alınamadı" });
  }
});

router.post("/templates", async (req, res) => {
  const {
    account_id,
    fatura_sikligi,
    baslangic_tarihi,
    sonraki_fatura_tarihi,
    aciklama,
    miktar,
    birim_fiyat,
    kdv_orani,
  } = req.body || {};

  if (!account_id || !fatura_sikligi) {
    return res.status(400).json({ error: "account_id ve fatura_sikligi zorunlu" });
  }
  if (!SIKLIKLAR.includes(fatura_sikligi)) {
    return res.status(400).json({ error: "geçersiz fatura_sikligi" });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO invoice_templates
         (user_id, business_id, account_id, fatura_sikligi, baslangic_tarihi, sonraki_fatura_tarihi, aciklama, miktar, birim_fiyat, kdv_orani)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        req.userId,
        req.businessId,
        account_id,
        fatura_sikligi,
        baslangic_tarihi || null,
        sonraki_fatura_tarihi || null,
        aciklama || null,
        miktar || 1,
        birim_fiyat || 0,
        kdv_orani ?? 20,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "şablon kaydedilemedi" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const { rows: invoices } = await pool.query(
      `SELECT i.*, a.cari_adi
       FROM invoices i
       JOIN accounts a ON a.id = i.account_id
       WHERE i.id = $1 AND i.business_id = $2`,
      [req.params.id, req.businessId]
    );
    if (!invoices[0]) {
      return res.status(404).json({ error: "fatura bulunamadı" });
    }
    const { rows: kalemler } = await pool.query(
      `SELECT id, aciklama, miktar, birim_fiyat, kdv_orani, tutar
       FROM invoice_items WHERE invoice_id = $1`,
      [req.params.id]
    );
    res.json({ ...invoices[0], kalemler });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "fatura detayı alınamadı" });
  }
});

router.post("/", async (req, res) => {
  const { account_id, branch_id, fatura_turu, kesim_tarihi, vade_tarihi, fatura_notu, kalemler } = req.body || {};

  if (!account_id || !fatura_turu || !kesim_tarihi) {
    return res.status(400).json({ error: "account_id, fatura_turu, kesim_tarihi zorunlu" });
  }
  if (!TURLER.includes(fatura_turu)) {
    return res.status(400).json({ error: "geçersiz fatura_turu" });
  }
  if (!Array.isArray(kalemler) || kalemler.length === 0) {
    return res.status(400).json({ error: "en az bir kalem gerekli" });
  }

  const client = await pool.connect();
  try {
    const own = await client.query(
      `SELECT id FROM accounts WHERE id = $1 AND business_id = $2`,
      [account_id, req.businessId]
    );
    if (!own.rows[0]) {
      return res.status(400).json({ error: "cari bulunamadı" });
    }

    await client.query("BEGIN");
    const faturaNo = await nextFaturaNo(req.businessId, client);
    const items = kalemler.map((k) => ({
      aciklama: k.aciklama || "",
      miktar: Number(k.miktar || 1),
      birim_fiyat: Number(k.birim_fiyat || 0),
      kdv_orani: Number(k.kdv_orani ?? 20),
      tutar: kalemTutar(k),
    }));
    const tutar = items.reduce((s, k) => s + k.tutar, 0);

    const { rows } = await client.query(
      `INSERT INTO invoices
         (user_id, business_id, branch_id, account_id, fatura_no, fatura_turu, kesim_tarihi, vade_tarihi, fatura_notu, tutar)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        req.userId,
        req.businessId,
        branch_id || null,
        account_id,
        faturaNo,
        fatura_turu,
        kesim_tarihi,
        vade_tarihi || null,
        fatura_notu || null,
        tutar,
      ]
    );
    const invoice = rows[0];

    for (const k of items) {
      await client.query(
        `INSERT INTO invoice_items (invoice_id, aciklama, miktar, birim_fiyat, kdv_orani, tutar)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [invoice.id, k.aciklama, k.miktar, k.birim_fiyat, k.kdv_orani, k.tutar]
      );
    }

    await client.query("COMMIT");
    res.status(201).json({ ...invoice, kalemler: items });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "fatura oluşturulamadı" });
  } finally {
    client.release();
  }
});

router.post("/:id/payment", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.*, a.cari_adi, a.email AS cari_email, a.telefon AS cari_telefon
       FROM invoices i JOIN accounts a ON a.id = i.account_id
       WHERE i.id = $1 AND i.business_id = $2`,
      [req.params.id, req.businessId]
    );
    const invoice = rows[0];
    if (!invoice) {
      return res.status(404).json({ error: "fatura bulunamadı" });
    }
    if (invoice.durum === "Ödendi") {
      return res.status(400).json({ error: "fatura zaten ödenmiş" });
    }

    const price = Number(invoice.tutar).toFixed(2);

    // iyzico anahtarı yoksa demo ödeme: faturayı Ödendi yap.
    // Production'da anahtar eksikse sessizce "ödendi" göstermek yerine hata dön.
    if (!isIyzicoConfigured()) {
      if (process.env.NODE_ENV === "production") {
        return res.status(503).json({ error: "Ödeme sağlayıcısı yapılandırılmamış" });
      }
      await pool.query(
        `UPDATE invoices SET durum = 'Ödendi' WHERE id = $1`,
        [invoice.id]
      );
      await pool.query(
        `INSERT INTO payments (invoice_id, saglayici, token, durum, tutar)
         VALUES ($1, 'demo', $2, 'Basarili', $3)`,
        [invoice.id, "demo-" + invoice.id + "-" + Date.now(), price]
      );
      return res.json({
        demo: true,
        message: "Demo ödeme tamamlandı (iyzico anahtarı tanımlı değil)",
      });
    }

    const iyzipay = getIyzicoClient();
    const callbackUrl = `${req.protocol}://${req.get("host")}/api/invoices/${invoice.id}/payment-callback`;
    const [ad, ...soyadParts] = String(invoice.cari_adi).trim().split(/\s+/);
    const soyad = soyadParts.join(" ") || ad;

    const request = {
      locale: Iyzipay.LOCALE.TR,
      conversationId: invoice.id,
      price,
      paidPrice: price,
      currency: Iyzipay.CURRENCY.TRY,
      basketId: invoice.fatura_no,
      paymentGroup: Iyzipay.PAYMENT_GROUP.PRODUCT,
      callbackUrl,
      buyer: {
        id: invoice.account_id,
        name: ad,
        surname: soyad,
        gsmNumber: invoice.cari_telefon || "+905000000000",
        email: invoice.cari_email || "musteri@ceptefatura.com",
        identityNumber: "11111111111",
        registrationAddress: "Bilinmiyor",
        ip: req.ip || "127.0.0.1",
        city: "Istanbul",
        country: "Turkey",
        zipCode: "34000",
      },
      shippingAddress: {
        contactName: invoice.cari_adi,
        city: "Istanbul",
        country: "Turkey",
        address: "Bilinmiyor",
        zipCode: "34000",
      },
      billingAddress: {
        contactName: invoice.cari_adi,
        city: "Istanbul",
        country: "Turkey",
        address: "Bilinmiyor",
        zipCode: "34000",
      },
      basketItems: [
        {
          id: invoice.id,
          name: `Fatura ${invoice.fatura_no}`,
          category1: "Fatura",
          itemType: Iyzipay.BASKET_ITEM_TYPE.VIRTUAL,
          price,
        },
      ],
    };

    iyzipay.checkoutFormInitialize.create(request, async (err, result) => {
      if (err || !result || result.status !== "success") {
        console.error(err || result);
        return res.status(502).json({ error: "ödeme başlatılamadı" });
      }
      try {
        await pool.query(
          `INSERT INTO payments (invoice_id, saglayici, token, durum, tutar) VALUES ($1, 'iyzico', $2, 'Basladi', $3)`,
          [invoice.id, result.token, price]
        );
        res.json({ paymentPageUrl: result.paymentPageUrl });
      } catch (dbErr) {
        console.error(dbErr);
        res.status(500).json({ error: "ödeme kaydı oluşturulamadı" });
      }
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "ödeme başlatılamadı" });
  }
});

module.exports = router;
