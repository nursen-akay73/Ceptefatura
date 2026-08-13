// Bağımsız doğrulama scripti — npm bağımlılığı olmadan pure calculateTotals mantığını test eder.
// Çalıştırma: node test_calculations.js
const assert = require("assert");
const { calculateTotals, round2 } = require("./invoices.calculations");

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`OK   ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}: ${err.message}`);
    process.exitCode = 1;
  }
}

check("tek kalem: %20 KDV doğru hesaplanır", () => {
  const { items, tutar } = calculateTotals([
    { aciklama: "Danışmanlık", miktar: 1, birim_fiyat: 1000, kdv_orani: 20 },
  ]);
  assert.strictEqual(items[0].tutar, 1200);
  assert.strictEqual(tutar, 1200);
});

check("çoklu kalem: toplam kalemlerin toplamı olur", () => {
  const { tutar } = calculateTotals([
    { aciklama: "A", miktar: 2, birim_fiyat: 150.5, kdv_orani: 20 }, // 301 + 60.2 = 361.2
    { aciklama: "B", miktar: 1, birim_fiyat: 99.99, kdv_orani: 10 }, // 99.99 + 9.999 = 109.989 -> 109.99
  ]);
  assert.strictEqual(tutar, round2(361.2 + 109.99));
});

check("kdv_orani 0 olabilir", () => {
  const { items } = calculateTotals([
    { aciklama: "Muaf ürün", miktar: 1, birim_fiyat: 500, kdv_orani: 0 },
  ]);
  assert.strictEqual(items[0].tutar, 500);
});

check("float birikim hatası yok (0.1 + 0.2 tipi senaryo)", () => {
  const { tutar } = calculateTotals([
    { aciklama: "A", miktar: 1, birim_fiyat: 0.1, kdv_orani: 0 },
    { aciklama: "B", miktar: 1, birim_fiyat: 0.2, kdv_orani: 0 },
  ]);
  assert.strictEqual(tutar, 0.3);
});

check("aciklama eksikse hata fırlatır (400)", () => {
  assert.throws(
    () => calculateTotals([{ aciklama: "", miktar: 1, birim_fiyat: 10, kdv_orani: 20 }]),
    /aciklama/
  );
});

check("miktar <= 0 ise hata fırlatır", () => {
  assert.throws(() =>
    calculateTotals([{ aciklama: "A", miktar: 0, birim_fiyat: 10, kdv_orani: 20 }])
  );
  assert.throws(() =>
    calculateTotals([{ aciklama: "A", miktar: -1, birim_fiyat: 10, kdv_orani: 20 }])
  );
});

check("birim_fiyat negatifse hata fırlatır", () => {
  assert.throws(() =>
    calculateTotals([{ aciklama: "A", miktar: 1, birim_fiyat: -5, kdv_orani: 20 }])
  );
});

check("miktar/fiyat sayı değilse hata fırlatır", () => {
  assert.throws(() =>
    calculateTotals([{ aciklama: "A", miktar: "abc", birim_fiyat: 10, kdv_orani: 20 }])
  );
});

check("boş kalem listesi -> boş sonuç, hata yok (route seviyesinde ayrıca zorunlu kontrol var)", () => {
  const { items, tutar } = calculateTotals([]);
  assert.strictEqual(items.length, 0);
  assert.strictEqual(tutar, 0);
});

check("hata durumunda ApiError.status = 400 taşır", () => {
  try {
    calculateTotals([{ aciklama: "A", miktar: -1, birim_fiyat: 10, kdv_orani: 20 }]);
    throw new Error("hata fırlatmadı");
  } catch (err) {
    assert.strictEqual(err.status, 400);
  }
});

console.log(`\n${passed} test geçti.`);
