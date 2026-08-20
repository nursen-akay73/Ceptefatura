// Fatura/fiş görüntüsünden Tesseract.js (yerel/ücretsiz OCR) ile metin okuyup,
// regex tabanlı sezgisel kurallarla alanları (cari adı, tarih, kalemler...) çıkarır.
//
// ÖNEMLİ NOT: Bu tamamen yerel/kural tabanlı bir çözümdür (bulut AI kullanmaz,
// ekstra maliyeti yoktur). Ancak OCR + regex ikilisi, gerçek dünyadaki eğik/buruşuk/
// düşük çözünürlüklü fiş fotoğraflarında bazen yanlış veya eksik okuma yapabilir —
// bu yüzden çıkarılan bilgiler her zaman "Yeni Fatura" formuna doldurulup kullanıcı
// kontrolüne/sunulur, otomatik kaydedilmez. Yanlış okunan alanları kullanıcı elle
// düzeltip öyle kaydeder.
//
// Kurulum: backend klasöründe `npm install` çalıştırın (tesseract.js ve sharp
// package.json'a eklendi). İlk çalıştırmada Tesseract, İngilizce+Türkçe dil
// verisini (~15 MB) internetten indirip önbelleğe alır; sonraki taramalar
// internet gerektirmez.

const Tesseract = require("tesseract.js");

let sharp = null;
try {
  sharp = require("sharp");
} catch {
  sharp = null;
}

const ALLOWED_OCR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

async function preprocessImage(buffer) {
  if (!sharp) return buffer;
  try {
    return await sharp(buffer)
      .rotate() // EXIF yönünü düzelt
      .resize({ width: 2200, withoutEnlargement: false })
      .grayscale()
      .normalize()
      .sharpen()
      .toBuffer();
  } catch {
    return buffer;
  }
}

async function runOcr(buffer) {
  const { data } = await Tesseract.recognize(buffer, "eng+tur");
  return data.text || "";
}

// --- Alan çıkarma yardımcıları -------------------------------------------

function normalizeNumber(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/[₺TL\s]/gi, "");
  if (!s) return null;
  if (s.includes(".") && s.includes(",")) {
    // 1.234,56 -> 1234.56 (Türkçe binlik/ondalık)
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function extractDate(text, afterIndex = 0) {
  const re = /(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/g;
  re.lastIndex = afterIndex;
  const m = re.exec(text);
  if (!m) return null;
  const [, d, mo, y] = m;
  const dd = d.padStart(2, "0");
  const mm = mo.padStart(2, "0");
  if (Number(mm) > 12 || Number(dd) > 31) return null;
  return `${y}-${mm}-${dd}`;
}

function extractLabeledValue(lines, labelPatterns) {
  for (const line of lines) {
    for (const pattern of labelPatterns) {
      const re = new RegExp(pattern + "\\s*[:.]?\\s*(.+)$", "i");
      const m = line.match(re);
      if (m && m[1] && m[1].trim().length > 1) {
        return m[1].trim();
      }
    }
  }
  return null;
}

function extractCariAdi(lines) {
  const value = extractLabeledValue(lines, [
    "M[uü]şteri\\s*Ad[ıi]\\s*Soyad[ıi]",
    "M[uü]ş\\.?\\s*Ad[ıi]\\s*Soyad[ıi]",
    "Sayın",
    "Al[ıi]c[ıi]",
    "M[uü]şteri",
    "Firma\\s*Ad[ıi]",
  ]);
  if (!value) return null;
  // Sadece harf/boşluk/nokta içeren makul uzunlukta bir isim gibi görünsün
  const cleaned = value.replace(/[^\p{L}\s.]/gu, "").trim();
  return cleaned.length >= 2 ? cleaned : null;
}

function extractFaturaNo(lines) {
  return extractLabeledValue(lines, ["Fatura\\s*No", "Fiş\\s*No", "Belge\\s*No"]);
}

function extractGenelToplam(text) {
  const re = /(vergi\s*dahil\s*[oö]denecek\s*tutar|genel\s*toplam|toplam\s*tutar)\D{0,10}([\d.,]+)/gi;
  let match;
  let last = null;
  while ((match = re.exec(text))) {
    const n = normalizeNumber(match[2]);
    if (n != null) last = n;
  }
  return last;
}

function extractKalemler(lines) {
  const skipPattern = /stok\s*kodu|stok\s*ad[ıi]|kdv\s*oran|mal\s*hizmet|[oö]deme\s*tipi|toplam|iskonto|vergi|fatura\s*no|sipariş\s*no|etin|v\.?n\.?|v\.?d\.?/i;
  // "<açıklama> <adet> <kdv%> <birim fiyat> <tutar>" gibi sondan sayısal
  // sütunlu satırları yakalamayı dener (fiş/fatura kalem tablolarında yaygın düzen).
  const rowRe = /^(.{3,60}?)\s+(\d{1,4})\s+(\d{1,3})\s+([\d.,]{1,12})\s+([\d.,]{1,12})\s*$/;
  const kalemler = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length < 6 || skipPattern.test(line)) continue;

    const m = line.match(rowRe);
    if (!m) continue;

    const [, aciklamaRaw, miktarStr, kdvStr, birimStr, tutarStr] = m;
    const miktar = normalizeNumber(miktarStr) ?? 1;
    const kdv_orani = normalizeNumber(kdvStr);
    const birim_fiyat = normalizeNumber(birimStr);
    const tutar = normalizeNumber(tutarStr);

    if (birim_fiyat == null || kdv_orani == null || kdv_orani > 100) continue;

    // Satır başındaki "stok kodu" gibi tek bir kod bloğunu açıklamadan ayıkla
    const aciklama = aciklamaRaw.replace(/^[A-ZÇĞİÖŞÜ0-9]{2,10}\s+/i, "").trim() || aciklamaRaw.trim();

    kalemler.push({
      aciklama,
      miktar,
      // birim_fiyat sütunu genelde KDV'li görünür; KDV hariç fiyata çevir
      birim_fiyat: Math.round((birim_fiyat / (1 + kdv_orani / 100)) * 100) / 100,
      kdv_orani,
      _tutar_kontrol: tutar,
    });
  }

  return kalemler.map(({ _tutar_kontrol, ...rest }) => rest);
}

function buildFallbackKalem(text) {
  const toplam = extractGenelToplam(text);
  if (toplam == null) return [];
  return [
    {
      aciklama: "Taranan belge (satırlar otomatik okunamadı, lütfen düzenleyin)",
      miktar: 1,
      birim_fiyat: Math.round((toplam / 1.2) * 100) / 100,
      kdv_orani: 20,
    },
  ];
}

// --- Ana giriş noktası -----------------------------------------------------

async function extractInvoiceFromDocument(fileBuffer, mimetype) {
  if (!ALLOWED_OCR_TYPES.has(mimetype)) {
    const err = new Error(
      "PDF taraması bu modda desteklenmiyor, lütfen fotoğraf (JPG/PNG/WEBP) olarak yükleyin."
    );
    err.status = 400;
    throw err;
  }

  let processed;
  try {
    processed = await preprocessImage(fileBuffer);
  } catch {
    processed = fileBuffer;
  }

  let text;
  try {
    text = await runOcr(processed);
  } catch (err) {
    const wrapped = new Error("Görüntü okunamadı (OCR başarısız oldu)");
    wrapped.status = 502;
    throw wrapped;
  }

  if (!text || text.trim().length < 5) {
    const err = new Error("Görüntüden metin okunamadı, daha net bir fotoğrafla tekrar deneyin.");
    err.status = 422;
    throw err;
  }

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const cari_adi = extractCariAdi(lines);
  const tarih = extractDate(text);
  const fatura_notu = extractFaturaNo(lines);

  let kalemler = extractKalemler(lines);
  if (kalemler.length === 0) {
    kalemler = buildFallbackKalem(text);
  }

  return {
    cari_adi,
    tarih,
    vade_tarihi: null,
    fatura_notu,
    kalemler,
  };
}

module.exports = { extractInvoiceFromDocument };
