// Bellek içi (in-memory) sahte "Postgres" katmanı.
// Amaç: Gerçek bir PostgreSQL bağlantısı OLMADAN, gerçek Express uygulamasını ve
// gerçek route/middleware/JWT/bcrypt kodunu uçtan uca test edebilmek.
//
// Sadece backend/src/modules/**/*.routes.js dosyalarının ürettiği SORGU KALIPLARINI
// tanır (genel amaçlı bir SQL motoru DEĞİLDİR). Yeni bir sorgu eklerseniz burada da
// karşılığını eklemeniz gerekir — aksi halde "Desteklenmeyen sorgu (mock)" hatası alırsınız.
//
// KULLANIM: Üretimde kullanılmaz. Sadece db/pool.js içinde MOCK_DB=true iken devreye girer.

let seq = { users: 0, accounts: 0, invoices: 0, invoice_items: 0, invoice_templates: 0 };
let store = { users: [], accounts: [], invoices: [], invoice_items: [], invoice_templates: [] };

function resetMockStore() {
  seq = { users: 0, accounts: 0, invoices: 0, invoice_items: 0, invoice_templates: 0 };
  store = { users: [], accounts: [], invoices: [], invoice_items: [], invoice_templates: [] };
}

function nextId(table) {
  seq[table] += 1;
  return seq[table];
}

function eqId(a, b) {
  return Number(a) === Number(b);
}

function norm(text) {
  return text.replace(/\s+/g, " ").trim();
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function publicUser(u) {
  return { id: u.id, ad_soyad: u.ad_soyad, isletme_adi: u.isletme_adi, email: u.email, created_at: u.created_at };
}

// Frontend/backend arasındaki gibi ILIKE '%x%' aramasını basit bir
// case-insensitive substring karşılaştırmasına indirger.
function likeMatch(value, pattern) {
  if (value == null) return false;
  const needle = String(pattern).replace(/^%/, "").replace(/%$/, "").toLowerCase();
  return String(value).toLowerCase().includes(needle);
}

async function handleQuery(rawText, params = []) {
  const text = norm(rawText);

  // ---- transaction kontrol komutları client.query() üzerinden de gelebilir ----
  if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") {
    return { rows: [], rowCount: 0 };
  }

  // ================= USERS =================
  if (text.startsWith("INSERT INTO users")) {
    const [ad_soyad, isletme_adi, email, sifre_hash] = params;
    const row = {
      id: nextId("users"),
      ad_soyad,
      isletme_adi,
      email,
      sifre_hash,
      created_at: new Date().toISOString(),
    };
    store.users.push(row);
    return { rows: [publicUser(row)], rowCount: 1 };
  }

  if (text.startsWith("SELECT id FROM users WHERE email")) {
    const row = store.users.find((u) => u.email === params[0]);
    return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 };
  }

  if (text.startsWith("SELECT * FROM users WHERE email")) {
    const row = store.users.find((u) => u.email === params[0]);
    return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
  }

  if (text.startsWith("SELECT id, ad_soyad, isletme_adi, email, created_at FROM users WHERE id")) {
    const row = store.users.find((u) => eqId(u.id, params[0]));
    return { rows: row ? [publicUser(row)] : [], rowCount: row ? 1 : 0 };
  }

  if (text.startsWith("UPDATE users SET")) {
    const [ad_soyad, isletme_adi, id] = params;
    const row = store.users.find((u) => eqId(u.id, id));
    if (!row) return { rows: [], rowCount: 0 };
    if (ad_soyad != null) row.ad_soyad = ad_soyad;
    if (isletme_adi != null) row.isletme_adi = isletme_adi;
    return { rows: [publicUser(row)], rowCount: 1 };
  }

  // ================= ACCOUNTS (cari) =================
  if (text.startsWith("SELECT id FROM accounts WHERE id") && text.includes("AND user_id")) {
    const [id, userId] = params;
    const row = store.accounts.find((a) => eqId(a.id, id) && eqId(a.user_id, userId));
    return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 };
  }

  if (text.startsWith("SELECT * FROM accounts WHERE id") && text.includes("AND user_id")) {
    const [id, userId] = params;
    const row = store.accounts.find((a) => eqId(a.id, id) && eqId(a.user_id, userId));
    return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
  }

  if (text.startsWith("SELECT * FROM accounts WHERE user_id")) {
    const userId = params[0];
    let rows = store.accounts.filter((a) => eqId(a.user_id, userId));
    if (text.includes("ILIKE")) {
      const term = params[1];
      rows = rows.filter(
        (a) =>
          likeMatch(a.cari_adi, term) ||
          likeMatch(a.vergi_no, term) ||
          likeMatch(a.telefon, term) ||
          likeMatch(a.email, term)
      );
    }
    rows = [...rows].sort((a, b) => String(a.cari_adi).localeCompare(String(b.cari_adi), "tr"));
    return { rows, rowCount: rows.length };
  }

  if (text.startsWith("INSERT INTO accounts")) {
    const [user_id, cari_adi, turu, vergi_no, telefon, email] = params;
    const row = {
      id: nextId("accounts"),
      user_id,
      cari_adi,
      turu,
      vergi_no,
      telefon,
      email,
      bakiye: 0,
      created_at: new Date().toISOString(),
    };
    store.accounts.push(row);
    return { rows: [row], rowCount: 1 };
  }

  if (text.startsWith("UPDATE accounts SET")) {
    const [cari_adi, turu, vergi_no, telefon, email, id, userId] = params;
    const row = store.accounts.find((a) => eqId(a.id, id) && eqId(a.user_id, userId));
    if (!row) return { rows: [], rowCount: 0 };
    if (cari_adi != null) row.cari_adi = cari_adi;
    if (turu != null) row.turu = turu;
    if (vergi_no != null) row.vergi_no = vergi_no;
    if (telefon != null) row.telefon = telefon;
    if (email != null) row.email = email;
    return { rows: [row], rowCount: 1 };
  }

  if (text.startsWith("DELETE FROM accounts")) {
    const [id, userId] = params;
    const before = store.accounts.length;
    store.accounts = store.accounts.filter((a) => !(eqId(a.id, id) && eqId(a.user_id, userId)));
    const rowCount = before - store.accounts.length;
    return { rows: [], rowCount };
  }

  // ================= INVOICE TEMPLATES (önce kontrol edilmeli — "invoices" alt-string'i içeriyor) =================
  if (text.startsWith("SELECT T.*, A.CARI_ADI FROM INVOICE_TEMPLATES") || text.includes("FROM invoice_templates t")) {
    const userId = params[0];
    const rows = store.invoice_templates
      .filter((t) => eqId(t.user_id, userId))
      .map((t) => ({ ...t, cari_adi: store.accounts.find((a) => eqId(a.id, t.account_id))?.cari_adi }))
      .sort((a, b) => {
        if (!a.sonraki_fatura_tarihi) return 1;
        if (!b.sonraki_fatura_tarihi) return -1;
        return a.sonraki_fatura_tarihi < b.sonraki_fatura_tarihi ? -1 : 1;
      });
    return { rows, rowCount: rows.length };
  }

  if (text.startsWith("INSERT INTO invoice_templates")) {
    const [user_id, account_id, fatura_sikligi, baslangic_tarihi, aciklama, miktar, birim_fiyat, kdv_orani] = params;
    const row = {
      id: nextId("invoice_templates"),
      user_id,
      account_id,
      fatura_sikligi,
      baslangic_tarihi,
      sonraki_fatura_tarihi: baslangic_tarihi,
      aciklama,
      miktar,
      birim_fiyat,
      kdv_orani,
    };
    store.invoice_templates.push(row);
    return { rows: [row], rowCount: 1 };
  }

  // ================= INVOICE ITEMS (önce kontrol edilmeli) =================
  if (text.startsWith("SELECT * FROM invoice_items")) {
    const invoiceId = params[0];
    const rows = store.invoice_items
      .filter((it) => eqId(it.invoice_id, invoiceId))
      .sort((a, b) => a.id - b.id);
    return { rows, rowCount: rows.length };
  }

  if (text.startsWith("INSERT INTO invoice_items")) {
    const [invoice_id, aciklama, miktar, birim_fiyat, kdv_orani, tutar] = params;
    const row = { id: nextId("invoice_items"), invoice_id, aciklama, miktar, birim_fiyat, kdv_orani, tutar };
    store.invoice_items.push(row);
    return { rows: [row], rowCount: 1 };
  }

  // ================= DASHBOARD (gelir/tahsilat) =================
  if (text.startsWith("SELECT COALESCE(SUM(tutar), 0) AS toplam FROM invoices")) {
    const userId = params[0];
    let rows = store.invoices.filter((i) => eqId(i.user_id, userId));
    if (text.includes("EXTRACT(MONTH")) {
      const [, ay, yil] = params;
      rows = rows.filter((i) => {
        const d = new Date(i.kesim_tarihi);
        return i.durum !== "İptal" && d.getMonth() + 1 === Number(ay) && d.getFullYear() === Number(yil);
      });
    } else if (text.includes("durum = 'Bekliyor'")) {
      rows = rows.filter((i) => i.durum === "Bekliyor");
    }
    const toplam = rows.reduce((s, i) => s + Number(i.tutar), 0);
    return { rows: [{ toplam }], rowCount: 1 };
  }

  if (text.startsWith("SELECT id, fatura_no, vade_tarihi, tutar FROM invoices")) {
    const userId = params[0];
    const rows = store.invoices
      .filter((i) => eqId(i.user_id, userId) && i.durum === "Bekliyor" && i.vade_tarihi != null)
      .sort((a, b) => (a.vade_tarihi < b.vade_tarihi ? -1 : 1))
      .slice(0, 5)
      .map((i) => ({ id: i.id, fatura_no: i.fatura_no, vade_tarihi: i.vade_tarihi, tutar: i.tutar }));
    return { rows, rowCount: rows.length };
  }

  // ================= INVOICES =================
  if (text.startsWith("SELECT COUNT(*)::INT AS ADET FROM INVOICES") || text.startsWith("SELECT COUNT(*)::int AS adet FROM invoices")) {
    const [userId, year] = params;
    const count = store.invoices.filter(
      (i) => eqId(i.user_id, userId) && new Date(i.kesim_tarihi).getFullYear() === Number(year)
    ).length;
    return { rows: [{ adet: count }], rowCount: 1 };
  }

  if (text.startsWith("INSERT INTO invoices")) {
    const [user_id, account_id, fatura_no, fatura_turu, kesim_tarihi, vade_tarihi, fatura_notu, tutar] = params;
    const row = {
      id: nextId("invoices"),
      user_id,
      account_id,
      fatura_no,
      fatura_turu,
      kesim_tarihi,
      vade_tarihi,
      fatura_notu,
      tutar,
      durum: "Bekliyor",
      created_at: new Date().toISOString(),
    };
    store.invoices.push(row);
    return { rows: [row], rowCount: 1 };
  }

  if (text.startsWith("SELECT I.*, A.CARI_ADI FROM INVOICES I") || text.startsWith("SELECT i.*, a.cari_adi FROM invoices i")) {
    // Tekil detay mı yoksa liste mi olduğunu WHERE koşuluna bakarak ayırıyoruz.
    if (text.includes("i.id =") && text.includes("i.user_id =")) {
      const [id, userId] = params;
      const row = store.invoices.find((i) => eqId(i.id, id) && eqId(i.user_id, userId));
      if (!row) return { rows: [], rowCount: 0 };
      const cari_adi = store.accounts.find((a) => eqId(a.id, row.account_id))?.cari_adi;
      return { rows: [{ ...row, cari_adi }], rowCount: 1 };
    }

    // Liste + opsiyonel search/status/type filtreleri (route'ta bu sırayla eklenir).
    const userId = params[0];
    let rows = store.invoices.filter((i) => eqId(i.user_id, userId));
    let paramIdx = 1;
    if (text.includes("ILIKE")) {
      const term = params[paramIdx++];
      rows = rows.filter((i) => {
        const cari_adi = store.accounts.find((a) => eqId(a.id, i.account_id))?.cari_adi;
        return likeMatch(i.fatura_no, term) || likeMatch(cari_adi, term);
      });
    }
    if (text.includes("i.durum =")) {
      const status = params[paramIdx++];
      rows = rows.filter((i) => i.durum === status);
    }
    if (text.includes("i.fatura_turu =")) {
      const type = params[paramIdx++];
      rows = rows.filter((i) => i.fatura_turu === type);
    }
    rows = rows
      .map((i) => ({ ...i, cari_adi: store.accounts.find((a) => eqId(a.id, i.account_id))?.cari_adi }))
      .sort((a, b) => (a.kesim_tarihi < b.kesim_tarihi ? 1 : a.kesim_tarihi > b.kesim_tarihi ? -1 : b.id - a.id));
    return { rows, rowCount: rows.length };
  }

  if (text.startsWith("UPDATE invoices SET DURUM = 'İPTAL'") || text.startsWith("UPDATE invoices SET durum = 'İptal'")) {
    const [id, userId] = params;
    const row = store.invoices.find((i) => eqId(i.id, id) && eqId(i.user_id, userId));
    if (!row) return { rows: [], rowCount: 0 };
    row.durum = "İptal";
    return { rows: [row], rowCount: 1 };
  }

  if (text.startsWith("UPDATE invoices SET")) {
    const [vade_tarihi, fatura_notu, durum, id, userId] = params;
    const row = store.invoices.find((i) => eqId(i.id, id) && eqId(i.user_id, userId));
    if (!row) return { rows: [], rowCount: 0 };
    if (vade_tarihi != null) row.vade_tarihi = vade_tarihi;
    if (fatura_notu != null) row.fatura_notu = fatura_notu;
    if (durum != null) row.durum = durum;
    return { rows: [row], rowCount: 1 };
  }

  throw new Error(`Desteklenmeyen sorgu (mock): ${text}`);
}

// pg.Pool ile aynı arayüz: query(), connect() -> { query, release }
function createMockPool() {
  return {
    query: (text, params) => handleQuery(text, params),
    connect: async () => {
      let snapshot = null;
      return {
        query: async (text, params) => {
          const norma = norm(text);
          if (norma === "BEGIN") {
            snapshot = clone(store);
            return { rows: [], rowCount: 0 };
          }
          if (norma === "COMMIT") {
            snapshot = null;
            return { rows: [], rowCount: 0 };
          }
          if (norma === "ROLLBACK") {
            if (snapshot) store = snapshot;
            snapshot = null;
            return { rows: [], rowCount: 0 };
          }
          return handleQuery(text, params);
        },
        release: () => {},
      };
    },
    on: () => {},
  };
}

module.exports = { createMockPool, resetMockStore };
