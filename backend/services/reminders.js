// Vadesi yaklaşan/geçen faturalar için otomatik hatırlatma/bildirim mekanizması.
// Dış bir e-posta/SMS servisi yapılandırılı değilse (bu projede henüz yok),
// bildirimler `notifications` tablosuna yazılır ve /api/notifications
// üzerinden uygulama içi bildirim olarak sunulur. E-posta/push eklenmek
// istenirse sweepOnce() içindeki INSERT'ten sonra tek bir yer değiştirir.

const { pool } = require("../db");

const YAKLASAN_GUN = 3; // vade_tarihi bugünden itibaren şu kadar gün içindeyse "yaklaşıyor" say

function money(n) {
  return Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });
}

// Vadesi bugünden önce olup hâlâ 'Bekliyor' görünen faturaları 'Gecikti' olarak
// işaretler. Daha önce hiçbir yerde bu geçişi otomatik yapan kod yoktu; durum
// alanı elle değiştirilmediği sürece hep 'Bekliyor' kalıyordu.
async function markOverdueInvoices(client) {
  await client.query(
    `UPDATE invoices SET durum = 'Gecikti'
     WHERE durum = 'Bekliyor' AND vade_tarihi IS NOT NULL AND vade_tarihi < CURRENT_DATE`
  );
}

// Ödenen/kapanan faturalar için bekleyen hatırlatmaları temizler.
// Faturayı 'Ödendi' yapan her yol (payment-callback, demo ödeme, PATCH ile
// elle işaretleme) bunu çağırmalı.
async function clearNotificationsForInvoice(invoiceId, db = pool) {
  await db.query(`DELETE FROM notifications WHERE invoice_id = $1`, [invoiceId]);
}

// Tek bir taramada: gecikmiş faturaları işaretle, yaklaşan/geciken faturalar
// için (varsa) eksik bildirimleri oluştur. `businessId` verilirse sadece o
// işletme için çalışır (manuel/test tetiklemesi); verilmezse tüm işletmeler
// için çalışır (arka plan zamanlayıcısı).
async function sweepOnce(businessId = null) {
  const client = await pool.connect();
  let created = 0;
  try {
    await client.query("BEGIN");
    await markOverdueInvoices(client);

    const values = [];
    let businessFilter = "";
    if (businessId) {
      values.push(businessId);
      businessFilter = `AND i.business_id = $${values.length}`;
    }

    const { rows: candidates } = await client.query(
      `SELECT i.id, i.business_id, i.fatura_no, i.tutar, i.vade_tarihi, i.durum, a.cari_adi
       FROM invoices i
       JOIN accounts a ON a.id = i.account_id
       WHERE i.durum IN ('Bekliyor', 'Gecikti')
         AND i.vade_tarihi IS NOT NULL
         AND i.vade_tarihi <= CURRENT_DATE + INTERVAL '${YAKLASAN_GUN} days'
         ${businessFilter}`,
      values
    );

    for (const inv of candidates) {
      const tur = inv.durum === "Gecikti" ? "vade_gecti" : "vade_yaklasiyor";
      const mesaj =
        tur === "vade_gecti"
          ? `${inv.fatura_no} numaralı fatura (${inv.cari_adi}, ₺${money(inv.tutar)}) vadesi geçti.`
          : `${inv.fatura_no} numaralı fatura (${inv.cari_adi}, ₺${money(inv.tutar)}) vadesi ${inv.vade_tarihi.toISOString().slice(0, 10)} tarihinde doluyor.`;

      const { rowCount } = await client.query(
        `INSERT INTO notifications (business_id, invoice_id, tur, mesaj)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (invoice_id, tur) DO NOTHING`,
        [inv.business_id, inv.id, tur, mesaj]
      );
      created += rowCount;
    }

    await client.query("COMMIT");
    return { taranan: candidates.length, olusturulan: created };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

let intervalHandle = null;

// Sunucu açılışında bir kez, sonra düzenli aralıklarla taramayı çalıştırır.
function startReminderScheduler(intervalMs = 60 * 60 * 1000) {
  const run = () => {
    sweepOnce().catch((err) => console.error("Hatırlatma taraması başarısız:", err));
  };
  run();
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = setInterval(run, intervalMs);
  return intervalHandle;
}

function stopReminderScheduler() {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}

module.exports = {
  sweepOnce,
  clearNotificationsForInvoice,
  startReminderScheduler,
  stopReminderScheduler,
};
