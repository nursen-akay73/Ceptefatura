const router = require("express").Router();
const { pool } = require("../db");
const { requireAuth, resolveBusinessContext } = require("../middleware/auth");
const { classifyIntent } = require("../lib/assistantIntents");

router.use(requireAuth, resolveBusinessContext);

const money = (n) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });

function monthRange() {
  const now = new Date();
  const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().slice(0, 10);
  return { start, end };
}

// Cepte Asistan'ın kalbi: sadece burada tanınan komutlar için gerçek veri
// döner. Tanınmayan her mesajda boş obje dönülür ki frontend kendi zengin
// SSS bilgi tabanına (CF_ASSISTANT_KB) düşsün — bu route onunla yarışmaz.
//
// Yazma niyetleri ("yeni fatura oluştur" vb.) burada asla INSERT/UPDATE
// yapmaz: sadece bir `pending_action` (hedef endpoint + payload) döner.
// Gerçek kayıt, kullanıcı sohbet arayüzünde açıkça onayladıktan SONRA
// frontend'in var olan (POST /api/invoices, /api/accounts, /api/expenses)
// endpoint'lerini çağırmasıyla olur — böylece o endpoint'lerin auth/tenant
// izolasyonu ve doğrulama mantığı hiç tekrarlanmadan aynen uygulanır.
router.post("/chat", async (req, res) => {
  const message = String((req.body && req.body.message) || "").trim();
  if (!message) {
    return res.json({});
  }

  const intent = classifyIntent(message);
  if (!intent) {
    return res.json({});
  }

  try {
    const businessId = req.businessId;

    if (intent.type === "count_invoices_this_month") {
      const { start, end } = monthRange();
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM invoices
         WHERE business_id = $1 AND kesim_tarihi >= $2 AND kesim_tarihi < $3`,
        [businessId, start, end]
      );
      return res.json({ reply: `Bu ay ${rows[0].n} fatura kestiniz.` });
    }

    if (intent.type === "total_revenue") {
      const { rows } = await pool.query(
        `SELECT COALESCE(SUM(tutar), 0) AS toplam FROM invoices WHERE business_id = $1`,
        [businessId]
      );
      return res.json({ reply: `Toplam kesilen fatura tutarınız (cironuz) ₺${money(rows[0].toplam)}.` });
    }

    if (intent.type === "unpaid_invoices") {
      const { rows } = await pool.query(
        `SELECT i.fatura_no, a.cari_adi, i.tutar
         FROM invoices i JOIN accounts a ON a.id = i.account_id
         WHERE i.business_id = $1 AND i.durum IN ('Bekliyor', 'Gecikti')
         ORDER BY i.vade_tarihi ASC NULLS LAST
         LIMIT 5`,
        [businessId]
      );
      if (!rows.length) {
        return res.json({ reply: "Ödenmemiş faturanız yok." });
      }
      const list = rows.map((r) => `${r.fatura_no} (${r.cari_adi}, ₺${money(r.tutar)})`).join("; ");
      return res.json({ reply: `Ödenmemiş faturalarınız: ${list}.`, href: "invoices.html", hrefLabel: "Faturalara git" });
    }

    if (intent.type === "expenses_this_month") {
      const { start, end } = monthRange();
      const { rows } = await pool.query(
        `SELECT COALESCE(SUM(tutar), 0) AS toplam FROM expenses
         WHERE business_id = $1 AND tarih >= $2 AND tarih < $3`,
        [businessId, start, end]
      );
      return res.json({ reply: `Bu ayki gideriniz ₺${money(rows[0].toplam)}.` });
    }

    if (intent.type === "create_invoice") {
      const { rows: matches } = await pool.query(
        `SELECT id, cari_adi FROM accounts WHERE business_id = $1 AND cari_adi ILIKE $2 LIMIT 5`,
        [businessId, `%${intent.customer}%`]
      );
      if (!matches.length) {
        return res.json({
          reply: `"${intent.customer}" adında bir cari bulamadım. Önce Cari Hesaplar sayfasından ekleyin.`,
          href: "accounts.html",
          hrefLabel: "Cari ekle",
        });
      }
      if (matches.length > 1) {
        return res.json({
          reply: `Birden fazla "${intent.customer}" eşleşmesi buldum: ${matches.map((m) => m.cari_adi).join(", ")}. Lütfen tam adını yazın.`,
        });
      }
      const account = matches[0];
      const today = new Date().toISOString().slice(0, 10);
      return res.json({
        reply: `"${account.cari_adi}" için ₺${money(intent.amount)} tutarında fatura oluşturmamı onaylıyor musunuz?`,
        pending_action: {
          type: "create_invoice",
          label: "Faturayı oluştur",
          endpoint: "/api/invoices",
          method: "POST",
          payload: {
            account_id: account.id,
            fatura_turu: "E-Fatura",
            kesim_tarihi: today,
            kalemler: [{ aciklama: "Hizmet", miktar: 1, birim_fiyat: intent.amount, kdv_orani: 0 }],
          },
        },
      });
    }

    if (intent.type === "create_account") {
      return res.json({
        reply: `"${intent.customer}" adlı cariyi eklememi onaylıyor musunuz?`,
        pending_action: {
          type: "create_account",
          label: "Cariyi ekle",
          endpoint: "/api/accounts",
          method: "POST",
          payload: { cari_adi: intent.customer },
        },
      });
    }

    if (intent.type === "create_expense") {
      const today = new Date().toISOString().slice(0, 10);
      const aciklama = intent.description || null;
      return res.json({
        reply: `₺${money(intent.amount)} tutarında${aciklama ? " (" + aciklama + ")" : ""} gider kaydetmemi onaylıyor musunuz?`,
        pending_action: {
          type: "create_expense",
          label: "Gideri kaydet",
          endpoint: "/api/expenses",
          method: "POST",
          payload: { tarih: today, tutar: intent.amount, kategori: "Diğer", aciklama },
        },
      });
    }

    return res.json({});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "asistan isteği işlenemedi" });
  }
});

module.exports = router;
