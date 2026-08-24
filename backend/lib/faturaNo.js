// Türkiye'deki e-Fatura numaralandırma biçimi: 3 harfli seri kodu + yıl (4 hane)
// + sıra numarası (9 hane) -- örn. "YLM2026000000001".
const TR_VOWELS = new Set(["A", "E", "I", "İ", "O", "Ö", "U", "Ü"]);
const TR_TO_ASCII = { Ç: "C", Ğ: "G", I: "I", İ: "I", Ö: "O", Ş: "S", Ü: "U" };

function faturaSeriKodu(isletmeAdi) {
  const harfler = String(isletmeAdi || "")
    .toLocaleUpperCase("tr-TR")
    .replace(/[^A-ZÇĞİÖŞÜ]/g, "");

  const suffixSessiz = new Array(harfler.length + 1).fill(0);
  for (let i = harfler.length - 1; i >= 0; i--) {
    suffixSessiz[i] = suffixSessiz[i + 1] + (TR_VOWELS.has(harfler[i]) ? 0 : 1);
  }

  let kod = "";
  for (let i = 0; i < harfler.length && kod.length < 3; i++) {
    const harf = harfler[i];
    if (!TR_VOWELS.has(harf)) {
      kod += harf;
    } else if (kod.length + suffixSessiz[i + 1] < 3) {
      kod += harf;
    }
  }
  kod = (kod + "XXX").slice(0, 3);
  return kod
    .split("")
    .map((harf) => TR_TO_ASCII[harf] || harf)
    .join("");
}

function formatFaturaNo(prefix, year, siraNo) {
  return `${prefix}${year}${String(siraNo).padStart(9, "0")}`;
}

module.exports = { faturaSeriKodu, formatFaturaNo };
