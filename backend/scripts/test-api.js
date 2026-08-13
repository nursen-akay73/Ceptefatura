// Yüksel'in modüllerini (auth, cari, fatura) gerçek bir sunucuya karşı uçtan uca test eder.
// Önkoşul: sunucu ayakta olmalı (npm run dev) ve DATABASE_URL geçerli bir Postgres'e bağlı olmalı.
//
// Çalıştırma:
//   node scripts/test-api.js
//   API_BASE_URL=http://localhost:3000 node scripts/test-api.js   (farklı port/host için)
//
// Node 18+ gerekir (global fetch kullanır). Ekstra paket kurmaya gerek yok.

const BASE = process.env.API_BASE_URL || "http://localhost:3000";

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`OK   ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL ${name}: ${err.message}`);
  }
}

async function api(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // gövde boş olabilir (örn. 204)
  }
  return { status: res.status, data };
}

async function main() {
  const stamp = Date.now();
  const email = `test-${stamp}@ceptefatura.test`;
  let token;
  let cariId;
  let invoiceId;

  await step("GET /api/health -> 200 ok:true", async () => {
    const { status, data } = await api("GET", "/api/health");
    assert(status === 200, `status ${status}`);
    assert(data.ok === true, "ok:true değil");
  });

  await step("POST /api/auth/register -> 201 + token", async () => {
    const { status, data } = await api("POST", "/api/auth/register", {
      ad_soyad: "Test Kullanıcı",
      isletme_adi: "Test İşletmesi",
      email,
      sifre: "sifre123",
      sifre_tekrar: "sifre123",
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(data)}`);
    assert(data.token, "token dönmedi");
    token = data.token;
  });

  await step("POST /api/auth/register (aynı email) -> 409", async () => {
    const { status } = await api("POST", "/api/auth/register", {
      ad_soyad: "X",
      isletme_adi: "Y",
      email,
      sifre: "sifre123",
      sifre_tekrar: "sifre123",
    });
    assert(status === 409, `status ${status}, 409 bekleniyordu`);
  });

  await step("POST /api/auth/login (yanlış şifre) -> 401", async () => {
    const { status } = await api("POST", "/api/auth/login", { email, sifre: "yanlis" });
    assert(status === 401, `status ${status}, 401 bekleniyordu`);
  });

  await step("POST /api/auth/login (doğru) -> 200 + token", async () => {
    const { status, data } = await api("POST", "/api/auth/login", { email, sifre: "sifre123" });
    assert(status === 200, `status ${status}`);
    assert(data.token, "token dönmedi");
    token = data.token;
  });

  await step("GET /api/accounts (token yok) -> 401", async () => {
    const { status } = await api("GET", "/api/accounts");
    assert(status === 401, `status ${status}, 401 bekleniyordu`);
  });

  await step("GET /api/auth/me -> profil bilgisi doğru", async () => {
    const { status, data } = await api("GET", "/api/auth/me", null, token);
    assert(status === 200, `status ${status}`);
    assert(data.email === email, "email eşleşmiyor");
    assert(data.isletme_adi === "Test İşletmesi", "isletme_adi eşleşmiyor");
  });

  await step("POST /api/accounts -> 201 yeni cari", async () => {
    const { status, data } = await api(
      "POST",
      "/api/accounts",
      { cari_adi: "Örnek Müşteri A.Ş.", turu: "Kurumsal", vergi_no: "1234567890" },
      token
    );
    assert(status === 201, `status ${status}: ${JSON.stringify(data)}`);
    cariId = data.id;
  });

  await step("GET /api/accounts?search=Örnek -> cari listede", async () => {
    const { status, data } = await api("GET", "/api/accounts?search=Örnek", null, token);
    assert(status === 200, `status ${status}`);
    assert(data.some((a) => a.id === cariId), "yeni cari listede yok");
  });

  await step("POST /api/invoices -> KDV/toplam doğru hesaplanıyor", async () => {
    const { status, data } = await api(
      "POST",
      "/api/invoices",
      {
        cari_id: cariId,
        fatura_turu: "E-Fatura",
        kesim_tarihi: new Date().toISOString().slice(0, 10),
        kalemler: [
          { aciklama: "Danışmanlık", miktar: 2, birim_fiyat: 500, kdv_orani: 20 }, // 1000 + 200 = 1200
          { aciklama: "Kurulum", miktar: 1, birim_fiyat: 300, kdv_orani: 10 }, // 300 + 30 = 330
        ],
      },
      token
    );
    assert(status === 201, `status ${status}: ${JSON.stringify(data)}`);
    assert(data.tutar === 1530, `tutar 1530 bekleniyordu, ${data.tutar} geldi`);
    assert(/^FTR-\d{4}-\d{4}$/.test(data.fatura_no), `fatura_no formatı hatalı: ${data.fatura_no}`);
    assert(data.kalemler.length === 2, "kalem sayısı 2 değil");
    invoiceId = data.id;
  });

  await step("POST /api/invoices (kalem eksik alan) -> 400", async () => {
    const { status } = await api(
      "POST",
      "/api/invoices",
      {
        cari_id: cariId,
        fatura_turu: "E-Fatura",
        kesim_tarihi: new Date().toISOString().slice(0, 10),
        kalemler: [{ aciklama: "", miktar: 1, birim_fiyat: 100, kdv_orani: 20 }],
      },
      token
    );
    assert(status === 400, `status ${status}, 400 bekleniyordu`);
  });

  await step("GET /api/invoices/:id -> kalemlerle birlikte döner", async () => {
    const { status, data } = await api("GET", `/api/invoices/${invoiceId}`, null, token);
    assert(status === 200, `status ${status}`);
    assert(data.kalemler.length === 2, "kalem sayısı 2 değil");
    assert(data.cari_adi === "Örnek Müşteri A.Ş.", "cari_adi join çalışmıyor");
  });

  await step("PUT /api/invoices/:id (durum=Ödendi) -> güncellenir", async () => {
    const { status, data } = await api(
      "PUT",
      `/api/invoices/${invoiceId}`,
      { durum: "Ödendi" },
      token
    );
    assert(status === 200, `status ${status}`);
    assert(data.durum === "Ödendi", "durum güncellenmedi");
  });

  await step("PUT /api/invoices/:id (geçersiz durum) -> 400", async () => {
    const { status } = await api(
      "PUT",
      `/api/invoices/${invoiceId}`,
      { durum: "Uydurma" },
      token
    );
    assert(status === 400, `status ${status}, 400 bekleniyordu`);
  });

  await step("GET /api/invoices?status=Ödendi -> filtre çalışıyor", async () => {
    const { status, data } = await api("GET", "/api/invoices?status=Ödendi", null, token);
    assert(status === 200, `status ${status}`);
    assert(data.some((i) => i.id === invoiceId), "fatura filtrelenmiş listede yok");
  });

  await step("DELETE /api/invoices/:id -> durum İptal olur (kayıt silinmez)", async () => {
    const { status, data } = await api("DELETE", `/api/invoices/${invoiceId}`, null, token);
    assert(status === 200, `status ${status}`);
    assert(data.durum === "İptal", "durum İptal olmadı");
  });

  await step("POST /api/invoices/templates -> tekrarlayan şablon oluşur", async () => {
    const { status, data } = await api(
      "POST",
      "/api/invoices/templates",
      {
        cari_id: cariId,
        fatura_sikligi: "Aylık",
        baslangic_tarihi: new Date().toISOString().slice(0, 10),
        aciklama: "Aylık hizmet bedeli",
        miktar: 1,
        birim_fiyat: 1000,
        kdv_orani: 20,
      },
      token
    );
    assert(status === 201, `status ${status}: ${JSON.stringify(data)}`);
  });

  await step("GET /api/invoices/templates -> şablon listede", async () => {
    const { status, data } = await api("GET", "/api/invoices/templates", null, token);
    assert(status === 200, `status ${status}`);
    assert(data.some((t) => t.account_id === cariId), "şablon listede yok");
  });

  console.log(`\n${passed} geçti, ${failed} başarısız. (${BASE})`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Script çalıştırılamadı:", err.message);
  console.error("Sunucu ayakta mı? (npm run dev) DATABASE_URL doğru mu?");
  process.exitCode = 1;
});
