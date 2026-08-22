const router = require("express").Router();
const { pool } = require("../db");
const { requireAuth, resolveBusinessContext } = require("../middleware/auth");

router.use(requireAuth, resolveBusinessContext);

const MONTHS_SHORT_TR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const MONTHS_LONG_TR = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

function periodRange(period) {
  const year = new Date().getFullYear();
  const month = Number(period);
  if (!period || period === "all" || !month || month < 1 || month > 12) {
    return { start: `${year}-01-01`, end: `${year + 1}-01-01`, granularity: "month" };
  }
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const end = new Date(year, month, 1).toISOString().slice(0, 10);
  return { start, end, granularity: "day" };
}

// Dönem bazlı gelir/gider/KDV özeti ve grafik verisi — reports.html için.
router.get("/summary", async (req, res) => {
  try {
    const businessId = req.businessId;
    const { start, end, granularity } = periodRange(req.query.period);

    const { rows: totalsRows } = await pool.query(
      `SELECT
         COALESCE((SELECT SUM(tutar) FROM invoices WHERE business_id=$1 AND kesim_tarihi >= $2 AND kesim_tarihi < $3), 0) AS gelir,
         COALESCE((SELECT SUM(tutar) FROM expenses WHERE business_id=$1 AND tarih >= $2 AND tarih < $3), 0) AS gider`,
      [businessId, start, end]
    );

    const { rows: vatSalesRows } = await pool.query(
      `SELECT COALESCE(SUM(ii.miktar * ii.birim_fiyat * ii.kdv_orani / 100), 0) AS kdv_satis
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       WHERE i.business_id = $1 AND i.kesim_tarihi >= $2 AND i.kesim_tarihi < $3`,
      [businessId, start, end]
    );

    const { rows: vatBuyRows } = await pool.query(
      `SELECT COALESCE(SUM(tutar) * 20 / 120, 0) AS kdv_alis
       FROM expenses WHERE business_id = $1 AND tarih >= $2 AND tarih < $3`,
      [businessId, start, end]
    );

    const { rows: gelirBuckets } = await pool.query(
      `SELECT date_trunc($4, kesim_tarihi) AS bucket, SUM(tutar) AS toplam
       FROM invoices WHERE business_id = $1 AND kesim_tarihi >= $2 AND kesim_tarihi < $3
       GROUP BY 1`,
      [businessId, start, end, granularity]
    );
    const { rows: giderBuckets } = await pool.query(
      `SELECT date_trunc($4, tarih) AS bucket, SUM(tutar) AS toplam
       FROM expenses WHERE business_id = $1 AND tarih >= $2 AND tarih < $3
       GROUP BY 1`,
      [businessId, start, end, granularity]
    );

    const bucketMap = new Map();
    const mergeBuckets = (rows, key) => {
      rows.forEach((r) => {
        const k = r.bucket.getTime();
        if (!bucketMap.has(k)) bucketMap.set(k, { date: r.bucket, gelir: 0, gider: 0 });
        bucketMap.get(k)[key] = Number(r.toplam);
      });
    };
    mergeBuckets(gelirBuckets, "gelir");
    mergeBuckets(giderBuckets, "gider");

    const bars = [...bucketMap.values()]
      .sort((a, b) => a.date - b.date)
      .map((b) => ({
        label: granularity === "day" ? String(b.date.getDate()) : MONTHS_SHORT_TR[b.date.getMonth()],
        gelir: b.gelir,
        gider: b.gider,
        net: b.gelir - b.gider,
      }));

    const { rows: categoryRows } = await pool.query(
      `SELECT kategori, SUM(tutar) AS toplam
       FROM expenses WHERE business_id = $1 AND tarih >= $2 AND tarih < $3
       GROUP BY kategori ORDER BY toplam DESC`,
      [businessId, start, end]
    );
    const giderToplam = categoryRows.reduce((s, c) => s + Number(c.toplam), 0);
    const categories = categoryRows.map((c) => ({
      kategori: c.kategori,
      tutar: Number(c.toplam),
      pct: giderToplam ? Math.round((Number(c.toplam) / giderToplam) * 100) : 0,
    }));

    const gelir = Number(totalsRows[0].gelir);
    const gider = Number(totalsRows[0].gider);
    const kdvSatis = Number(vatSalesRows[0].kdv_satis);
    const kdvAlis = Number(vatBuyRows[0].kdv_alis);

    res.json({
      period: req.query.period || "all",
      granularity,
      gelir,
      gider,
      net: gelir - gider,
      kdv_satis: kdvSatis,
      kdv_alis: kdvAlis,
      kdv_net: kdvSatis - kdvAlis,
      bars,
      categories,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "rapor özeti alınamadı" });
  }
});

// Ana sayfa (dashboard.html) için özet: bu ay gelir/gider, bekleyen tahsilat,
// son faturalar, 12 aylık gelir-gider grafiği.
router.get("/dashboard", async (req, res) => {
  try {
    const businessId = req.businessId;
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().slice(0, 10);

    const { rows: monthRows } = await pool.query(
      `SELECT
         COALESCE((SELECT SUM(tutar) FROM invoices WHERE business_id=$1 AND kesim_tarihi >= $2 AND kesim_tarihi < $3), 0) AS bu_ay_gelir,
         COALESCE((SELECT SUM(tutar) FROM expenses WHERE business_id=$1 AND tarih >= $2 AND tarih < $3), 0) AS bu_ay_gider`,
      [businessId, monthStart, nextMonthStart]
    );

    const { rows: lifetimeRows } = await pool.query(
      `SELECT
         COALESCE((SELECT SUM(tutar) FROM invoices WHERE business_id=$1 AND durum='Ödendi'), 0) AS tahsil_edilen,
         COALESCE((SELECT SUM(tutar) FROM expenses WHERE business_id=$1), 0) AS toplam_gider,
         COALESCE((SELECT SUM(tutar) FROM invoices WHERE business_id=$1 AND durum IN ('Bekliyor','Gecikti')), 0) AS bekleyen_tahsilat,
         COALESCE((SELECT COUNT(*) FROM invoices WHERE business_id=$1 AND durum IN ('Bekliyor','Gecikti')), 0) AS bekleyen_fatura_sayisi`,
      [businessId]
    );

    const { rows: sonFaturalar } = await pool.query(
      `SELECT i.id, i.fatura_no, a.cari_adi AS cari, i.kesim_tarihi, i.tutar, i.durum
       FROM invoices i JOIN accounts a ON a.id = i.account_id
       WHERE i.business_id = $1
       ORDER BY i.kesim_tarihi DESC, i.created_at DESC
       LIMIT 5`,
      [businessId]
    );

    const { rows: yaklasanRows } = await pool.query(
      `SELECT a.cari_adi, i.vade_tarihi, i.kesim_tarihi
       FROM invoices i JOIN accounts a ON a.id = i.account_id
       WHERE i.business_id = $1 AND i.durum IN ('Bekliyor', 'Gecikti') AND i.vade_tarihi IS NOT NULL
       ORDER BY i.vade_tarihi ASC
       LIMIT 2`,
      [businessId]
    );
    const yaklasanOdemeler = yaklasanRows.map((o) => {
      const start = new Date(o.kesim_tarihi).getTime();
      const due = new Date(o.vade_tarihi).getTime();
      const now = Date.now();
      let pct = due > start ? ((now - start) / (due - start)) * 100 : 50;
      pct = Math.max(0, Math.min(100, Math.round(pct)));
      return { cari_adi: o.cari_adi, vade_tarihi: o.vade_tarihi, ilerleme_yuzde: pct };
    });

    const year = now.getFullYear();
    const { rows: gelirBuckets } = await pool.query(
      `SELECT date_trunc('month', kesim_tarihi) AS bucket, SUM(tutar) AS toplam
       FROM invoices WHERE business_id = $1 AND kesim_tarihi >= $2 AND kesim_tarihi < $3
       GROUP BY 1`,
      [businessId, `${year}-01-01`, `${year + 1}-01-01`]
    );
    const { rows: giderBuckets } = await pool.query(
      `SELECT date_trunc('month', tarih) AS bucket, SUM(tutar) AS toplam
       FROM expenses WHERE business_id = $1 AND tarih >= $2 AND tarih < $3
       GROUP BY 1`,
      [businessId, `${year}-01-01`, `${year + 1}-01-01`]
    );
    const gelirMap = new Map(gelirBuckets.map((r) => [r.bucket.getMonth(), Number(r.toplam)]));
    const giderMap = new Map(giderBuckets.map((r) => [r.bucket.getMonth(), Number(r.toplam)]));
    const cashflow = MONTHS_LONG_TR.map((label, idx) => ({
      month: String(idx + 1).padStart(2, "0"),
      label,
      gelir: gelirMap.get(idx) || 0,
      gider: giderMap.get(idx) || 0,
    }));

    res.json({
      // Not: Ayrı bir kasa/banka defteri tablosu yok; "toplam nakit" tahsil
      // edilmiş faturalar eksi tüm zamanların giderleri olarak yaklaşık hesaplanır.
      toplam_nakit: Number(lifetimeRows[0].tahsil_edilen) - Number(lifetimeRows[0].toplam_gider),
      bu_ay_gelir: Number(monthRows[0].bu_ay_gelir),
      bu_ay_gider: Number(monthRows[0].bu_ay_gider),
      bekleyen_tahsilat: Number(lifetimeRows[0].bekleyen_tahsilat),
      bekleyen_fatura_sayisi: Number(lifetimeRows[0].bekleyen_fatura_sayisi),
      son_faturalar: sonFaturalar,
      yaklasan_odemeler: yaklasanOdemeler,
      cashflow,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "panel özeti alınamadı" });
  }
});

module.exports = router;
