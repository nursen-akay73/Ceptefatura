const fs = require("fs");
const router = require("express").Router();
const Iyzipay = require("iyzipay");
const { pool } = require("../db");
const { requireAuth, resolveBusinessContext } = require("../middleware/auth");
const { upload } = require("../middleware/upload");
const { extractInvoiceFromDocument } = require("../services/documentScan");
const { getClient: getIyzicoClient, isConfigured: isIyzicoConfigured } = require("../lib/iyzico");
const { clearNotificationsForInvoice, sweepOnce } = require("../services/reminders");
const { buildInvoicePdf } = require("../services/invoicePdf");
const { faturaSeriKodu, formatFaturaNo } = require("../lib/faturaNo");

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
        await clearNotificationsForInvoice(payment.invoice_id);
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
    const extracted = await extractInvoiceFromDocument(
      fileBuffer,
      req.file.mimetype,
      req.file.originalname
    );
    const { _raw_text, ...payload } = extracted;
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || "Görüntü işlenemedi" });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

// İskonto, KDV'den ÖNCE net tutardan düşülür (gerçek fatura mantığı budur):
// önce miktar*birim_fiyat net tutarı bulunur, ondan iskonto_orani düşülür,
// KDV bu İSKONTOLU tutar üzerinden hesaplanır.
function kalemNetIskontolu(k) {
  const miktar = Number(k.miktar || 1);
  const birim = Number(k.birim_fiyat || 0);
  const iskontoOrani = Number(k.iskonto_orani || 0);
  const net = miktar * birim;
  return Math.round(net * (1 - iskontoOrani / 100) * 100) / 100;
}

function kalemTutar(k) {
  const kdv = Number(k.kdv_orani ?? 20);
  const netIskontolu = kalemNetIskontolu(k);
  return Math.round(netIskontolu * (1 + kdv / 100) * 100) / 100;
}

// Türkiye'deki e-Fatura numaralandırma biçimi: 3 harfli seri kodu + yıl (4 hane)
// + sıra numarası (9 hane) -- örn. "YLM2026000000001". Seri kodu HER İŞLETME
// İÇİN o işletmenin kendi adından türetilir (asla sabit "YLM" değildir) --
// örn. "Yılmaz" -> "YLM", "Zelal" -> "ZLL", "Mine" -> "MIN". Kural: harfler
// soldan sağa taranır, sessiz harfler her zaman alınır; bir sesli harf ise,
// yalnızca ondan SONRA gelen sessiz harf sayısı 3'ü tamamlamaya yetiyorsa
// atlanır -- yetmiyorsa (ör. "Mine"de M'den sonra tek sessiz harf -N- kalır)
// sesli harf de koda dahil edilir ki isim olduğu gibi tanınabilir kalsın.
// İsimde hiç harf yoksa (veya 3'ten az harf varsa) "X" ile tamamlanır.
// Gerçek e-Fatura "Fatura No" alanı yalnızca ASCII harf/rakam
// içerebildiğinden, Türkçe'ye özgü harfler (ç, ğ, ı, i, ö, ş, ü) ASCII
// karşılıklarına çevrilir.

async function nextFaturaNo(businessId, db = pool) {
  const year = new Date().getFullYear();

  const { rows: bizRows } = await db.query(
    `SELECT isletme_adi FROM businesses WHERE id = $1`,
    [businessId]
  );
  const prefix = faturaSeriKodu(bizRows[0] && bizRows[0].isletme_adi);

  // Sıra numarasını mevcut faturalar arasındaki en yüksek numaradan DEĞİL,
  // yalnızca artan ve asla azalmayan ayrı bir sayaç tablosundan (invoice_no_counters)
  // türetiyoruz. Aksi halde (en yüksek numaralı fatura silindiğinde, ör.
  // yanlışlıkla oluşturulmuş bir fatura), bir sonraki fatura o silinen
  // numarayı ikinci kez üretir -- ki bu gerçek e-Fatura numaralarında kabul
  // edilemez. Sayaç ON CONFLICT ile atomik olarak artırıldığından eşzamanlı
  // istekler de (iki kullanıcı aynı anda fatura kesse bile) aynı numarayı
  // asla iki kez üretemez.
  const { rows } = await db.query(
    `INSERT INTO invoice_no_counters (business_id, yil, son_sira)
     VALUES ($1, $2, 1)
     ON CONFLICT (business_id, yil)
     DO UPDATE SET son_sira = invoice_no_counters.son_sira + 1
     RETURNING son_sira`,
    [businessId, year]
  );

  const siraNo = rows[0].son_sira;

  return formatFaturaNo(prefix, year, siraNo);
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

// Vergi numaramız adına başka bir işletmenin kestiği faturalar ("gelen faturalar").
// Eşleştirme: faturayı kesen işletmenin seçtiği carinin (accounts.vergi_no) bizim
// işletmemizin vergi_no'suna eşit olması. Kendi kestiğimiz faturalar hariç tutulur.
router.get("/received", async (req, res) => {
  const { search, status, type } = req.query;

  try {
    const { rows: bizRows } = await pool.query(
      `SELECT vergi_no FROM businesses WHERE id = $1`,
      [req.businessId]
    );
    const myVergiNo = bizRows[0] && bizRows[0].vergi_no;
    if (!myVergiNo) {
      return res.json([]);
    }

    const conditions = ["a.vergi_no = $1", "i.business_id <> $2"];
    const values = [myVergiNo, req.businessId];

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
      conditions.push(`(i.fatura_no ILIKE $${values.length} OR b.isletme_adi ILIKE $${values.length})`);
    }

    const { rows } = await pool.query(
      `SELECT i.id, i.fatura_no, i.fatura_turu, i.kesim_tarihi AS tarih, i.vade_tarihi AS vade,
              i.tutar, i.durum, b.isletme_adi AS gonderen, b.vergi_no AS gonderen_vergi_no
       FROM invoices i
       JOIN accounts a ON a.id = i.account_id
       JOIN businesses b ON b.id = i.business_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY i.kesim_tarihi DESC`,
      values
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "gelen faturalar alınamadı" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const { rows: invoices } = await pool.query(
      `SELECT i.*, a.cari_adi, b.isletme_adi AS gonderen_isletme, b.vergi_no AS gonderen_vergi_no,
              (i.business_id <> $2) AS gelen
       FROM invoices i
       JOIN accounts a ON a.id = i.account_id
       JOIN businesses b ON b.id = i.business_id
       WHERE i.id = $1
         AND (
           i.business_id = $2
           OR a.vergi_no = (SELECT vergi_no FROM businesses WHERE id = $2)
         )`,
      [req.params.id, req.businessId]
    );
    if (!invoices[0]) {
      return res.status(404).json({ error: "fatura bulunamadı" });
    }
    const { rows: kalemler } = await pool.query(
      `SELECT id, aciklama, miktar, birim_fiyat, kdv_orani, iskonto_orani, tutar
       FROM invoice_items WHERE invoice_id = $1`,
      [req.params.id]
    );
    res.json({ ...invoices[0], kalemler });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "fatura detayı alınamadı" });
  }
});

// Türk e-Fatura çıktısına benzer görünümde bir PDF üretip indirir. Yetki
// kontrolü GET /:id ile birebir aynı: hem faturayı kesen işletme hem de
// (vergi no eşleşmesiyle) faturayı alan işletme PDF'i indirebilir.
router.get("/:id/pdf", async (req, res) => {
  try {
    const { rows: invoices } = await pool.query(
      `SELECT i.*, a.cari_adi, a.vergi_no AS cari_vergi_no, a.adres AS cari_adres,
              a.vergi_dairesi AS cari_vergi_dairesi,
              b.isletme_adi AS firma_isletme_adi, b.adres AS firma_adres, b.sehir AS firma_sehir,
              b.vergi_no AS firma_vergi_no, b.vergi_dairesi AS firma_vergi_dairesi
       FROM invoices i
       JOIN accounts a ON a.id = i.account_id
       JOIN businesses b ON b.id = i.business_id
       WHERE i.id = $1
         AND (
           i.business_id = $2
           OR a.vergi_no = (SELECT vergi_no FROM businesses WHERE id = $2)
         )`,
      [req.params.id, req.businessId]
    );
    const inv = invoices[0];
    if (!inv) {
      return res.status(404).json({ error: "fatura bulunamadı" });
    }
    const { rows: kalemler } = await pool.query(
      `SELECT aciklama, miktar, birim_fiyat, kdv_orani, iskonto_orani
       FROM invoice_items WHERE invoice_id = $1`,
      [req.params.id]
    );

    const pdfBuffer = await buildInvoicePdf({
      firma: {
        isletme_adi: inv.firma_isletme_adi,
        adres: inv.firma_adres,
        sehir: inv.firma_sehir,
        vergi_no: inv.firma_vergi_no,
        vergi_dairesi: inv.firma_vergi_dairesi,
      },
      cari: {
        cari_adi: inv.cari_adi,
        adres: inv.cari_adres,
        vergi_no: inv.cari_vergi_no,
        vergi_dairesi: inv.cari_vergi_dairesi,
      },
      fatura_no: inv.fatura_no,
      fatura_turu: inv.fatura_turu,
      kesim_tarihi: inv.kesim_tarihi,
      created_at: inv.created_at,
      fatura_notu: inv.fatura_notu,
      ettn: String(inv.id).toUpperCase(),
      kalemler,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${inv.fatura_no}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "fatura PDF'i oluşturulamadı" });
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
      iskonto_orani: Number(k.iskonto_orani || 0),
      tutar: kalemTutar(k),
    }));
    const tutar = items.reduce((s, k) => s + k.tutar, 0);

    const { rows } = await client.query(
      `INSERT INTO invoices
         (user_id, business_id, branch_id, account_id, fatura_no, fatura_turu, kesim_tarihi, vade_tarihi, fatura_notu, tutar, durum)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'Bekliyor')
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
        `INSERT INTO invoice_items (invoice_id, aciklama, miktar, birim_fiyat, kdv_orani, iskonto_orani, tutar)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [invoice.id, k.aciklama, k.miktar, k.birim_fiyat, k.kdv_orani, k.iskonto_orani, k.tutar]
      );
    }

    await client.query("COMMIT");
    try {
      await sweepOnce(req.businessId);
    } catch (err) {
      console.error("Fatura sonrası hatırlatma taraması:", err);
    }
    res.status(201).json({ ...invoice, kalemler: items });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "fatura oluşturulamadı" });
  } finally {
    client.release();
  }
});

// Sadece kendi kestiğimiz faturalar düzenlenebilir/silinebilir ("gelen
// faturalar" salt okunur — onları biz kesmedik). kalemler gönderilirse
// tamamı değiştirilir ve tutar yeniden hesaplanır; gönderilmezse kalemler
// ve tutar olduğu gibi kalır.
router.patch("/:id", async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows: existingRows } = await client.query(
      `SELECT * FROM invoices WHERE id = $1 AND business_id = $2`,
      [req.params.id, req.businessId]
    );
    const existing = existingRows[0];
    if (!existing) {
      return res.status(404).json({ error: "fatura bulunamadı" });
    }

    const body = req.body || {};
    const account_id = body.account_id || existing.account_id;
    const branch_id = "branch_id" in body ? body.branch_id || null : existing.branch_id;
    const fatura_turu = body.fatura_turu || existing.fatura_turu;
    const kesim_tarihi = body.kesim_tarihi || existing.kesim_tarihi;
    const vade_tarihi = "vade_tarihi" in body ? body.vade_tarihi || null : existing.vade_tarihi;
    const fatura_notu = "fatura_notu" in body ? body.fatura_notu || null : existing.fatura_notu;
    const durum = body.durum || existing.durum;

    if (!TURLER.includes(fatura_turu)) {
      return res.status(400).json({ error: "geçersiz fatura_turu" });
    }
    if (!DURUMLAR.includes(durum)) {
      return res.status(400).json({ error: "geçersiz durum" });
    }

    if (body.account_id) {
      const own = await client.query(
        `SELECT id FROM accounts WHERE id = $1 AND business_id = $2`,
        [account_id, req.businessId]
      );
      if (!own.rows[0]) {
        return res.status(400).json({ error: "cari bulunamadı" });
      }
    }

    await client.query("BEGIN");

    let tutar = existing.tutar;
    let items = null;
    if (Array.isArray(body.kalemler)) {
      if (body.kalemler.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "en az bir kalem gerekli" });
      }
      items = body.kalemler.map((k) => ({
        aciklama: k.aciklama || "",
        miktar: Number(k.miktar || 1),
        birim_fiyat: Number(k.birim_fiyat || 0),
        kdv_orani: Number(k.kdv_orani ?? 20),
        iskonto_orani: Number(k.iskonto_orani || 0),
        tutar: kalemTutar(k),
      }));
      tutar = items.reduce((s, k) => s + k.tutar, 0);

      await client.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [req.params.id]);
      for (const k of items) {
        await client.query(
          `INSERT INTO invoice_items (invoice_id, aciklama, miktar, birim_fiyat, kdv_orani, iskonto_orani, tutar)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [req.params.id, k.aciklama, k.miktar, k.birim_fiyat, k.kdv_orani, k.iskonto_orani, k.tutar]
        );
      }
    }

    const { rows } = await client.query(
      `UPDATE invoices
       SET account_id = $1, branch_id = $2, fatura_turu = $3, kesim_tarihi = $4,
           vade_tarihi = $5, fatura_notu = $6, durum = $7, tutar = $8
       WHERE id = $9 AND business_id = $10
       RETURNING *`,
      [account_id, branch_id, fatura_turu, kesim_tarihi, vade_tarihi, fatura_notu, durum, tutar, req.params.id, req.businessId]
    );

    await client.query("COMMIT");

    if (durum === "Ödendi") {
      await clearNotificationsForInvoice(req.params.id);
    } else {
      try {
        await sweepOnce(req.businessId);
      } catch (err) {
        console.error("Fatura güncelleme sonrası hatırlatma taraması:", err);
      }
    }

    if (!items) {
      const { rows: kalemler } = await pool.query(
        `SELECT id, aciklama, miktar, birim_fiyat, kdv_orani, iskonto_orani, tutar FROM invoice_items WHERE invoice_id = $1`,
        [req.params.id]
      );
      items = kalemler;
    }

    res.json({ ...rows[0], kalemler: items });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(err);
    res.status(500).json({ error: "fatura güncellenemedi" });
  } finally {
    client.release();
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM invoices WHERE id = $1 AND business_id = $2 RETURNING id`,
      [req.params.id, req.businessId]
    );
    if (!rows[0]) return res.status(404).json({ error: "fatura bulunamadı" });
    // invoice_items, payments ve notifications kayıtları ON DELETE CASCADE ile
    // otomatik silinir.
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "fatura silinemedi" });
  }
});

// Ödeme başlatma: hem faturayı kesen işletme (kendi kestiği faturada
// tahsilat başlatır) hem de faturanın muhatabı olan işletme (gelen faturada
// borcunu öder) bu uca erişebilir — GET /:id ile aynı çapraz-işletme kuralı.
router.post("/:id/payment", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.*, a.cari_adi, a.email AS cari_email, a.telefon AS cari_telefon
       FROM invoices i JOIN accounts a ON a.id = i.account_id
       WHERE i.id = $1
         AND (
           i.business_id = $2
           OR a.vergi_no = (SELECT vergi_no FROM businesses WHERE id = $2)
         )`,
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

    // Anahtar yoksa kırmızı hata dönme; demo tahsilat ekranı açılsın.
    if (!isIyzicoConfigured()) {
      return res.json({
        demo: true,
        amount: Number(price),
        fatura_no: invoice.fatura_no,
        cari_adi: invoice.cari_adi,
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
        res.json({
          paymentPageUrl: result.paymentPageUrl,
          checkoutFormContent: result.checkoutFormContent,
        });
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
