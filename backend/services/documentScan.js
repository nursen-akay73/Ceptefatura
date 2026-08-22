// Fatura/fiş görüntüsünden Tesseract.js (yerel/ücretsiz OCR) ile metin okuyup,
// regex tabanlı sezgisel kurallarla alanları çıkarır.
// Bulut AI yok; sonuç her zaman forma doldurulur, kullanıcı kontrol eder.

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
      .rotate()
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

function normalizeNumber(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/[₺$€£RM\s]/gi, "");
  if (!s) return null;
  // 6 204,19 veya 5 640.17 gibi boşluklu binlik
  s = s.replace(/\s/g, "");
  if (s.includes(".") && s.includes(",")) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (s.includes(",")) {
    const parts = s.split(",");
    if (parts[parts.length - 1].length === 2) {
      s = parts.slice(0, -1).join("") + "." + parts[parts.length - 1];
    } else {
      s = s.replace(",", ".");
    }
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function extractDate(text) {
  const re = /(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/g;
  let m;
  let best = null;
  while ((m = re.exec(text))) {
    let a = Number(m[1]);
    let b = Number(m[2]);
    const y = m[3];
    if (y < 1990 || y > 2100) continue;
    let day;
    let month;
    if (a > 12 && b <= 12) {
      day = a;
      month = b;
    } else if (b > 12 && a <= 12) {
      month = a;
      day = b;
    } else {
      // belirsiz: fişlerde genelde GG/AA
      day = a;
      month = b;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    best = `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    break;
  }
  return best;
}

function isNoiseName(value) {
  if (!value) return true;
  const v = String(value).trim().toLowerCase();
  if (v.length < 3) return true;
  return /^(bilgileri?|bilgi|ad[ıi]|soyad[ıi]|unvan[ıi]|tarih[ıi]?|tip[ıi]|senaryo|fatura|fi[sş]|müşteri|al[ıi]c[ıi]|sat[ıi]c[ıi]|firma|invoice|receipt|total|cash|customer|seller|client|say[ıi]n|no|evet|hay[ıi]r)$/i.test(
    v
  );
}

function cleanPersonOrCompanyName(value) {
  if (!value) return null;
  let cleaned = String(value)
    .replace(/^(unvan[ıi]|ad[ıi]\s*soyad[ıi]|ad[ıi]|firma\s*ad[ıi])\s*[:.]?\s*/i, "")
    .replace(/[^\p{L}\d\s.&'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 3 || isNoiseName(cleaned)) return null;
  return cleaned.slice(0, 80);
}

function extractLabeledValue(lines, labelPatterns) {
  for (const line of lines) {
    for (const pattern of labelPatterns) {
      const re = new RegExp("(?:^|\\b)" + pattern + "\\s*[:.]?\\s*(.+)$", "i");
      const m = line.match(re);
      if (m && m[1] && m[1].trim().length > 1) {
        const val = m[1].trim();
        // "Müşteri Bilgileri" gibi başlıkları isim sanma
        if (isNoiseName(val)) continue;
        if (/^(bilgileri|adı|soyadı)\b/i.test(val)) continue;
        return val;
      }
    }
  }
  return null;
}

function extractCariAdi(lines) {
  // Uzun etiketler önce — "Müşteri Bilgileri" satırını yakalamasın
  const value = extractLabeledValue(lines, [
    "M[uü]şteri\\s*Ad[ıi]\\s*Soyad[ıi]",
    "M[uü]ş\\.?\\s*Ad[ıi]\\s*Soyad[ıi]",
    "Al[ıi]c[ıi]\\s*Unvan[ıi]",
    "Al[ıi]c[ıi]\\s*Ad[ıi]",
    "Sayın",
    "Bill\\s*To",
    "BILL\\s*TO",
    "Client\\s*Name",
    "Client",
    "Al[ıi]c[ıi]",
    "M[uü]şteri\\s*Unvan[ıi]",
    "Firma\\s*Ad[ıi]",
  ]);
  if (!value || isNoiseName(value)) return null;
  return cleanPersonOrCompanyName(value);
}

/** Gider/fiş satıcısı: üstteki şirket adı (etiket yoksa). */
function extractVendorName(lines) {
  const labeled = extractLabeledValue(lines, [
    "Seller",
    "Sat[ıi]c[ıi]",
    "Firma\\s*Ad[ıi]",
    "Company",
  ]);
  if (labeled) {
    const cleaned = labeled.replace(/[^\p{L}\d\s.&'-]/gu, "").trim();
    if (cleaned.length >= 3) return cleaned.slice(0, 80);
  }

  const skip =
    /^(invoice|tax\s*invoice|receipt|cash\s*bill|fi[sş]|fatura|thank|tel[:\s]|fax[:\s]|gst|roc\s*no|iban|date|tarih|total|cashier|bill\s*to|ship\s*to|member|table|pax|no\.?\s*:|#|www\.|http|e-?mail)/i;
  const noiseName = /^(tan\s+woon\s+yann|cash|customer)$/i;

  for (let i = 0; i < Math.min(lines.length, 12); i++) {
    let line = lines[i].replace(/\s+/g, " ").trim();
    if (line.length < 4 || line.length > 70) continue;
    if (skip.test(line) || noiseName.test(line)) continue;
    if (/^\d+([./-]\d+){1,2}/.test(line)) continue;
    if (/^[\d\s.,RM$₺]+$/.test(line)) continue;
    if ((line.match(/\d/g) || []).length > line.length * 0.4) continue;
    // şirket benzeri: harf ağırlıklı
    const letters = (line.match(/\p{L}/gu) || []).length;
    if (letters < 4) continue;
    return line.slice(0, 80);
  }
  return null;
}

function extractFaturaNo(lines) {
  const value = extractLabeledValue(lines, [
    "Fatura\\s*No",
    "Fiş\\s*No",
    "Belge\\s*No",
    "Invoice\\s*#?",
    "INV\\s*No",
    "Bill\\s*No",
    "Document\\s*No",
  ]);
  if (!value || isNoiseName(value)) return null;
  // Not alanına uzun cümle / etiket yığını yazma
  if (value.length > 40) return null;
  if (/fatura\s*tarih|senaryo|fatura\s*tip/i.test(value)) return null;
  return value;
}

function extractGenelToplam(text) {
  const patterns = [
    /balance\s*due\D{0,12}([\d\s.,]+)/gi,
    /rounded\s*total(?:\s*\(?\s*RM\s*\)?)?\D{0,12}([\d\s.,]+)/gi,
    /gross\s*worth\D{0,12}([\d\s.,]+)/gi,
    /total\s*amt\.?\D{0,12}(?:RM\s*)?([\d\s.,]+)/gi,
    /(?:^|\n)\s*total(?:\s*\(?\s*RM\s*\)?)?\D{0,12}([\d\s.,]+)/gi,
    /genel\s*toplam\D{0,10}([\d\s.,]+)/gi,
    /toplam\s*tutar\D{0,10}([\d\s.,]+)/gi,
    /vergi\s*dahil\s*[oö]denecek\s*tutar\D{0,10}([\d\s.,]+)/gi,
    /TOTAL\s*[:.]?\s*(?:RM\s*)?([\d\s.,]+)/g,
  ];

  let best = null;
  for (const re of patterns) {
    let match;
    while ((match = re.exec(text))) {
      const n = normalizeNumber(match[1]);
      if (n != null && n > 0 && n < 1e8) best = n;
    }
    if (best != null) break;
  }
  return best;
}

function extractTaxAmount(text) {
  const re = /(?:GST|VAT|TAX|KDV)\s*(?:payable|@?\s*\d+\s*%?)?\D{0,12}([\d\s.,]+)/gi;
  let match;
  let last = null;
  while ((match = re.exec(text))) {
    const n = normalizeNumber(match[1]);
    if (n != null && n >= 0 && n < 1e7) last = n;
  }
  return last;
}

function extractKalemler(lines) {
  const skipPattern =
    /stok\s*kodu|stok\s*ad[ıi]|kdv\s*oran|mal\s*hizmet|[oö]deme\s*tipi|toplam|iskonto|vergi|fatura\s*no|sipariş\s*no|etin|v\.?n\.?|v\.?d\.?|subtotal|balance|rounding|change|cash\b|thank/i;
  const rowRe = /^(.{3,60}?)\s+(\d{1,4})\s+(\d{1,3})\s+([\d.,]{1,12})\s+([\d.,]{1,12})\s*$/;
  const kalemler = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length < 6 || skipPattern.test(line)) continue;

    const m = line.match(rowRe);
    if (!m) continue;

    const [, aciklamaRaw, miktarStr, kdvStr, birimStr] = m;
    const miktar = normalizeNumber(miktarStr) ?? 1;
    const kdv_orani = normalizeNumber(kdvStr);
    const birim_fiyat = normalizeNumber(birimStr);

    if (birim_fiyat == null || kdv_orani == null || kdv_orani > 100) continue;

    const aciklama = aciklamaRaw.replace(/^[A-ZÇĞİÖŞÜ0-9]{2,10}\s+/i, "").trim() || aciklamaRaw.trim();

    kalemler.push({
      aciklama,
      miktar,
      birim_fiyat: Math.round((birim_fiyat / (1 + kdv_orani / 100)) * 100) / 100,
      kdv_orani,
    });
  }

  return kalemler;
}

function buildFallbackKalem(text) {
  const toplam = extractGenelToplam(text);
  if (toplam == null) return [];
  const tax = extractTaxAmount(text);
  if (tax != null && tax > 0 && tax < toplam) {
    const net = Math.round((toplam - tax) * 100) / 100;
    const oran = Math.round((tax / net) * 100) || 0;
    return [
      {
        aciklama: "Taranan belge (kalemler otomatik okunamadı)",
        miktar: 1,
        birim_fiyat: net,
        kdv_orani: oran <= 25 ? oran : 0,
      },
    ];
  }
  return [
    {
      aciklama: "Taranan belge (kalemler otomatik okunamadı)",
      miktar: 1,
      birim_fiyat: Math.round(toplam * 100) / 100,
      kdv_orani: 0,
    },
  ];
}

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

  const cari_adi = extractCariAdi(lines) || extractVendorName(lines);
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
    _raw_text: text,
  };
}

async function extractExpenseFromDocument(fileBuffer, mimetype) {
  const inv = await extractInvoiceFromDocument(fileBuffer, mimetype);
  const text = inv._raw_text || "";
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let tutar = extractGenelToplam(text);
  let kdv = extractTaxAmount(text);

  if (tutar == null && inv.kalemler && inv.kalemler.length) {
    tutar = 0;
    kdv = kdv || 0;
    for (const k of inv.kalemler) {
      const miktar = Number(k.miktar || 1);
      const birim = Number(k.birim_fiyat || 0);
      const oran = Number(k.kdv_orani ?? 0);
      const ara = miktar * birim;
      const kdvSatir = ara * (oran / 100);
      tutar += ara + kdvSatir;
      if (!extractTaxAmount(text)) kdv += kdvSatir;
    }
    tutar = Math.round(tutar * 100) / 100;
    kdv = Math.round(Number(kdv) * 100) / 100;
  }

  if (tutar != null) tutar = Math.round(Number(tutar) * 100) / 100;
  if (kdv != null) kdv = Math.round(Number(kdv) * 100) / 100;

  const firma = extractVendorName(lines) || inv.cari_adi || null;

  return {
    firma,
    tarih: inv.tarih || null,
    tutar: tutar || null,
    kdv: kdv || null,
    aciklama: inv.fatura_notu || (inv.kalemler && inv.kalemler[0] && inv.kalemler[0].aciklama) || null,
  };
}

module.exports = { extractInvoiceFromDocument, extractExpenseFromDocument };
