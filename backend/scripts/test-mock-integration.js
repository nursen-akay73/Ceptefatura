// PostgreSQL'e HİÇ bağlanmadan, gerçek Express sunucusu bile başlatmadan,
// Yüksel'in yazdığı GERÇEK app.js + *.routes.js dosyalarını (hiç değiştirmeden)
// bellek içi sahte veritabanı (mockPool) + sahte express/bcrypt/jwt üzerinden
// uçtan uca çalıştırır.
//
// Çalıştırma: node scripts/test-mock-integration.js
// (npm install / .env / gerçek Postgres GEREKMEZ)

process.env.MOCK_DB = "true";
process.env.JWT_SECRET = "test-secret-yalnizca-mock-icin";
process.env.NODE_ENV = "test";

require("./lib/require-override");
const { request } = require("./lib/mini-express");

// require-override sayesinde app.js içindeki require("express")/("cors")/
// ("bcryptjs")/("jsonwebtoken") çağrıları sahte modüllere yönleniyor;
// require("./mockPool") ise zaten normal (gerçek) dosya yolundan yükleniyor.
const app = require("../src/app");
const { resetMockStore } = require("../src/db/mockPool");

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

async function main() {
  resetMockStore();

  const email = `test-${Date.now()}@ceptefatura.test`;
  let token;
  let cariId;
  let invoiceId;

  await step("GET /api/health -> 200 ok:true", async () => {
    const { status, body } = await request(app, { method: "GET", path: "/api/health" });
    assert(status === 200, `status ${status}`);
    assert(body.ok === true, "ok:true değil");
  });

  await step("GET /api/olmayan-endpoint -> 404", async () => {
    const { status } = await request(app, { method: "GET", path: "/api/olmayan-endpoint" });
    assert(status === 404, `status ${status}, 404 bekleniyordu`);
  });

  await step("POST /api/auth/register -> 201 + token", async () => {
    const { status, body } = await request(app, {
      method: "POST",
      path: "/api/auth/register",
      body: {
        ad_soyad: "Test Kullanıcı",
        isletme_adi: "Test İşletmesi",
        email,
        sifre: "sifre123",
        sifre_tekrar: "sifre123",
      },
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.token, "token dönmedi");
    token = body.token;
  });

  await step("POST /api/auth/register (aynı email) -> 409", async () => {
    const { status } = await request(app, {
      method: "POST",
      path: "/api/auth/register",
      body: { ad_soyad: "X", isletme_adi: "Y", email, sifre: "sifre123", sifre_tekrar: "sifre123" },
    });
    assert(status === 409, `status ${status}, 409 bekleniyordu`);
  });

  await step("POST /api/auth/register (şifreler uyuşmuyor) -> 400", async () => {
    const { status } = await request(app, {
      method: "POST",
      path: "/api/auth/register",
      body: {
        ad_soyad: "X",
        isletme_adi: "Y",
        email: `baska-${Date.now()}@test.test`,
        sifre: "sifre123",
        sifre_tekrar: "farkli",
      },
    });
    assert(status === 400, `status ${status}, 400 bekleniyordu`);
  });

  await step("POST /api/auth/login (yanlış şifre) -> 401", async () => {
    const { status } = await request(app, {
      method: "POST",
      path: "/api/auth/login",
      body: { email, sifre: "yanlis" },
    });
    assert(status === 401, `status ${status}, 401 bekleniyordu`);
  });

  await step("POST /api/auth/login (doğru) -> 200 + token", async () => {
    const { status, body } = await request(app, {
      method: "POST",
      path: "/api/auth/login",
      body: { email, sifre: "sifre123" },
    });
    assert(status === 200, `status ${status}`);
    assert(body.token, "token dönmedi");
    token = body.token;
  });

  await step("GET /api/accounts (token yok) -> 401", async () => {
    const { status } = await request(app, { method: "GET", path: "/api/accounts" });
    assert(status === 401, `status ${status}, 401 bekleniyordu`);
  });

  await step("GET /api/accounts (geçersiz token) -> 401", async () => {
    const { status } = await request(app, {
      method: "GET",
      path: "/api/accounts",
      headers: { authorization: "Bearer uydurma.token.deger" },
    });
    assert(status === 401, `status ${status}, 401 bekleniyordu`);
  });

  await step("GET /api/auth/me -> profil doğru", async () => {
    const { status, body } = await request(app, {
      method: "GET",
      path: "/api/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.email === email, "email eşleşmiyor");
  });

  await step("PUT /api/auth/me -> isletme_adi güncellenir", async () => {
    const { status, body } = await request(app, {
      method: "PUT",
      path: "/api/auth/me",
      headers: { authorization: `Bearer ${token}` },
      body: { isletme_adi: "Güncel İşletme Adı" },
    });
    assert(status === 200, `status ${status}`);
    assert(body.isletme_adi === "Güncel İşletme Adı", "isletme_adi güncellenmedi");
  });

  await step("POST /api/accounts (cari_adi eksik) -> 400", async () => {
    const { status } = await request(app, {
      method: "POST",
      path: "/api/accounts",
      headers: { authorization: `Bearer ${token}` },
      body: { turu: "Bireysel" },
    });
    assert(status === 400, `status ${status}, 400 bekleniyordu`);
  });

  await step("POST /api/accounts -> 201 yeni cari", async () => {
    const { status, body } = await request(app, {
      method: "POST",
      path: "/api/accounts",
      headers: { authorization: `Bearer ${token}` },
      body: { cari_adi: "Örnek Müşteri A.Ş.", turu: "Kurumsal", vergi_no: "1234567890" },
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    cariId = body.id;
  });

  await step("GET /api/accounts?search=Örnek -> cari listede", async () => {
    const { status, body } = await request(app, {
      method: "GET",
      path: "/api/accounts?search=Örnek",
      headers: { authorization: `Bearer ${token}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.some((a) => a.id === cariId), "yeni cari listede yok");
  });

  await step("GET /api/accounts?search=olmayan -> boş sonuç", async () => {
    const { status, body } = await request(app, {
      method: "GET",
      path: "/api/accounts?search=hicbirsonucyok",
      headers: { authorization: `Bearer ${token}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.length === 0, "boş sonuç bekleniyordu");
  });

  await step("PUT /api/accounts/:id -> günceller", async () => {
    const { status, body } = await request(app, {
      method: "PUT",
      path: `/api/accounts/${cariId}`,
      headers: { authorization: `Bearer ${token}` },
      body: { telefon: "5551234567" },
    });
    assert(status === 200, `status ${status}`);
    assert(body.telefon === "5551234567", "telefon güncellenmedi");
    assert(body.cari_adi === "Örnek Müşteri A.Ş.", "diğer alan korunmalıydı");
  });

  await step("POST /api/invoices (kalem eksik alan) -> 400", async () => {
    const { status } = await request(app, {
      method: "POST",
      path: "/api/invoices",
      headers: { authorization: `Bearer ${token}` },
      body: {
        cari_id: cariId,
        fatura_turu: "E-Fatura",
        kesim_tarihi: new Date().toISOString().slice(0, 10),
        kalemler: [{ aciklama: "", miktar: 1, birim_fiyat: 100, kdv_orani: 20 }],
      },
    });
    assert(status === 400, `status ${status}, 400 bekleniyordu`);
  });

  await step("POST /api/invoices (var olmayan cari_id) -> 404", async () => {
    const { status } = await request(app, {
      method: "POST",
      path: "/api/invoices",
      headers: { authorization: `Bearer ${token}` },
      body: {
        cari_id: 999999,
        fatura_turu: "E-Fatura",
        kesim_tarihi: new Date().toISOString().slice(0, 10),
        kalemler: [{ aciklama: "X", miktar: 1, birim_fiyat: 100, kdv_orani: 20 }],
      },
    });
    assert(status === 404, `status ${status}, 404 bekleniyordu`);
  });

  await step("POST /api/invoices -> KDV/toplam doğru, fatura_no üretildi", async () => {
    const { status, body } = await request(app, {
      method: "POST",
      path: "/api/invoices",
      headers: { authorization: `Bearer ${token}` },
      body: {
        cari_id: cariId,
        fatura_turu: "E-Fatura",
        kesim_tarihi: new Date().toISOString().slice(0, 10),
        kalemler: [
          { aciklama: "Danışmanlık", miktar: 2, birim_fiyat: 500, kdv_orani: 20 }, // 1200
          { aciklama: "Kurulum", miktar: 1, birim_fiyat: 300, kdv_orani: 10 }, // 330
        ],
      },
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.tutar === 1530, `tutar 1530 bekleniyordu, ${body.tutar} geldi`);
    assert(/^FTR-\d{4}-0001$/.test(body.fatura_no), `fatura_no formatı hatalı: ${body.fatura_no}`);
    assert(body.kalemler.length === 2, "kalem sayısı 2 değil");
    assert(body.durum === "Bekliyor", "başlangıç durumu Bekliyor olmalı");
    invoiceId = body.id;
  });

  await step("2. fatura -> fatura_no sırası artıyor (0002)", async () => {
    const { status, body } = await request(app, {
      method: "POST",
      path: "/api/invoices",
      headers: { authorization: `Bearer ${token}` },
      body: {
        cari_id: cariId,
        fatura_turu: "E-Arşiv",
        kesim_tarihi: new Date().toISOString().slice(0, 10),
        kalemler: [{ aciklama: "İkinci fatura", miktar: 1, birim_fiyat: 100, kdv_orani: 20 }],
      },
    });
    assert(status === 201, `status ${status}`);
    assert(/-0002$/.test(body.fatura_no), `sıra 0002 bekleniyordu: ${body.fatura_no}`);
  });

  await step("GET /api/invoices/:id -> kalemlerle birlikte döner", async () => {
    const { status, body } = await request(app, {
      method: "GET",
      path: `/api/invoices/${invoiceId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.kalemler.length === 2, "kalem sayısı 2 değil");
    assert(body.cari_adi === "Örnek Müşteri A.Ş.", "cari_adi join çalışmıyor");
  });

  await step("GET /api/invoices?type=E-Arşiv -> filtre çalışıyor", async () => {
    const { status, body } = await request(app, {
      method: "GET",
      path: "/api/invoices?type=E-Arşiv",
      headers: { authorization: `Bearer ${token}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.every((i) => i.fatura_turu === "E-Arşiv"), "filtre yanlış sonuç döndü");
    assert(body.length === 1, `1 fatura bekleniyordu, ${body.length} geldi`);
  });

  await step("GET /api/invoices?search=Örnek -> cari adına göre bulundu", async () => {
    const { status, body } = await request(app, {
      method: "GET",
      path: "/api/invoices?search=Örnek",
      headers: { authorization: `Bearer ${token}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.length === 2, `2 fatura bekleniyordu, ${body.length} geldi`);
  });

  await step("PUT /api/invoices/:id (durum=Ödendi) -> güncellenir", async () => {
    const { status, body } = await request(app, {
      method: "PUT",
      path: `/api/invoices/${invoiceId}`,
      headers: { authorization: `Bearer ${token}` },
      body: { durum: "Ödendi" },
    });
    assert(status === 200, `status ${status}`);
    assert(body.durum === "Ödendi", "durum güncellenmedi");
  });

  await step("PUT /api/invoices/:id (geçersiz durum) -> 400", async () => {
    const { status } = await request(app, {
      method: "PUT",
      path: `/api/invoices/${invoiceId}`,
      headers: { authorization: `Bearer ${token}` },
      body: { durum: "Uydurma" },
    });
    assert(status === 400, `status ${status}, 400 bekleniyordu`);
  });

  await step("GET /api/invoices?status=Ödendi -> filtre çalışıyor", async () => {
    const { status, body } = await request(app, {
      method: "GET",
      path: "/api/invoices?status=Ödendi",
      headers: { authorization: `Bearer ${token}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.some((i) => i.id === invoiceId), "fatura filtrelenmiş listede yok");
  });

  await step("DELETE /api/invoices/:id -> durum İptal olur (kayıt silinmez)", async () => {
    const { status, body } = await request(app, {
      method: "DELETE",
      path: `/api/invoices/${invoiceId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.durum === "İptal", "durum İptal olmadı");
  });

  await step("GET /api/invoices/:id -> iptal sonrası hâlâ erişilebilir", async () => {
    const { status, body } = await request(app, {
      method: "GET",
      path: `/api/invoices/${invoiceId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.durum === "İptal", "kayıt silinmiş/bozulmuş olmamalı");
  });

  await step("POST /api/invoices/templates -> tekrarlayan şablon oluşur", async () => {
    const { status, body } = await request(app, {
      method: "POST",
      path: "/api/invoices/templates",
      headers: { authorization: `Bearer ${token}` },
      body: {
        cari_id: cariId,
        fatura_sikligi: "Aylık",
        baslangic_tarihi: new Date().toISOString().slice(0, 10),
        aciklama: "Aylık hizmet bedeli",
        miktar: 1,
        birim_fiyat: 1000,
        kdv_orani: 20,
      },
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  });

  await step("GET /api/invoices/templates -> şablon listede (route sırası /:id ile çakışmıyor)", async () => {
    const { status, body } = await request(app, {
      method: "GET",
      path: "/api/invoices/templates",
      headers: { authorization: `Bearer ${token}` },
    });
    assert(status === 200, `status ${status}`);
    assert(Array.isArray(body), "dizi bekleniyordu");
    assert(body.some((t) => t.account_id === cariId), "şablon listede yok");
    assert(body[0].cari_adi === "Örnek Müşteri A.Ş.", "cari_adi join çalışmıyor");
  });

  // --- Dashboard (gelir/tahsilat) ---
  let invoiceWithVade;

  await step("GET /api/dashboard (token yok) -> 401", async () => {
    const { status } = await request(app, { method: "GET", path: "/api/dashboard" });
    assert(status === 401, `status ${status}, 401 bekleniyordu`);
  });

  await step("3. fatura -> vade tarihli, dashboard testi için", async () => {
    const vade = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { status, body } = await request(app, {
      method: "POST",
      path: "/api/invoices",
      headers: { authorization: `Bearer ${token}` },
      body: {
        cari_id: cariId,
        fatura_turu: "E-Fatura",
        kesim_tarihi: new Date().toISOString().slice(0, 10),
        vade_tarihi: vade,
        kalemler: [{ aciklama: "Vadeli hizmet", miktar: 1, birim_fiyat: 1000, kdv_orani: 20 }],
      },
    });
    assert(status === 201, `status ${status}`);
    assert(body.tutar === 1200, `tutar 1200 bekleniyordu, ${body.tutar} geldi`);
    invoiceWithVade = body;
  });

  await step("GET /api/dashboard -> bu_ay_gelir ve bekleyen_tahsilat doğru", async () => {
    const { status, body } = await request(app, {
      method: "GET",
      path: "/api/dashboard",
      headers: { authorization: `Bearer ${token}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    // İptal edilen ilk fatura (1530 TL) hariç tutulmalı; 2. fatura (120 TL, Bekliyor,
    // vadesiz) ve 3. fatura (1200 TL, Bekliyor, vadeli) bu ay kesildiği için dahil olmalı.
    assert(body.bu_ay_gelir === 1320, `bu_ay_gelir 1320 bekleniyordu, ${body.bu_ay_gelir} geldi`);
    assert(
      body.bekleyen_tahsilat === 1320,
      `bekleyen_tahsilat 1320 bekleniyordu, ${body.bekleyen_tahsilat} geldi`
    );
    assert(Array.isArray(body.vadesi_yaklasan_faturalar), "vadesi_yaklasan_faturalar dizi olmalı");
    assert(
      body.vadesi_yaklasan_faturalar.some((i) => i.id === invoiceWithVade.id),
      "vade tarihli fatura vadesi yaklaşanlar listesinde yok"
    );
    assert(
      !body.vadesi_yaklasan_faturalar.some((i) => i.id === invoiceId),
      "vadesiz/iptal fatura yanlışlıkla listede"
    );
    assert(body.bu_ay_gider === null, "bu_ay_gider henüz null olmalı (Şeyma'yı bekliyor)");
  });

  await step("DELETE /api/accounts/:id -> 204 (başka kullanıcı için 404)", async () => {
    const { status: badStatus } = await request(app, {
      method: "DELETE",
      path: `/api/accounts/999999`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert(badStatus === 404, `olmayan cari için 404 bekleniyordu, ${badStatus} geldi`);
  });

  console.log(`\n${passed} geçti, ${failed} başarısız.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Test scripti çalıştırılamadı:", err.stack || err.message);
  process.exitCode = 1;
});
