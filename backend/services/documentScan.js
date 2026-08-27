// Fatura/fiş görüntüsünden Tesseract.js (yerel/ücretsiz OCR) ile metin okuyup,
// regex tabanlı sezgisel kurallarla alanları çıkarır.
// Bulut AI yok; sonuç her zaman forma doldurulur, kullanıcı kontrol eder.

const Tesseract = require("tesseract.js");
const os = require("os");
const path = require("path");

let sharp = null;
try {
  sharp = require("sharp");
} catch {
  sharp = null;
}

const ALLOWED_OCR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PDF_TYPE = "application/pdf";

async function extractPdfText(buffer) {
  let pdfjs;
  try {
    pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
  } catch {
    const err = new Error("PDF okuma paketi yüklü değil. JPG/PNG deneyin veya sunucuyu güncelleyin.");
    err.status = 500;
    throw err;
  }
  try {
    const data = new Uint8Array(buffer);
    const loadingTask = pdfjs.getDocument({
      data,
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: true,
    });
    const pdf = await loadingTask.promise;
    const maxPages = Math.min(pdf.numPages, 4);
    const parts = [];
    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const items = content.items || [];
      let lastY = null;
      let buf = [];
      const lines = [];
      for (const it of items) {
        const str = it && it.str ? String(it.str) : "";
        if (!str) continue;
        const y = it.transform ? Math.round(it.transform[5]) : lastY;
        const newLine =
          (lastY != null && y != null && Math.abs(y - lastY) > 3) ||
          (buf.length > 0 && /^(Invoice\s*(Number|Date|No)|Due\s*Date|Bill\s*To|Ship\s*To|Total|Fatura\s*(No|Tarihi)|Vade|Sayın)/i.test(str.trim()));
        if (newLine) {
          if (buf.length) lines.push(buf.join(" ").replace(/\s+/g, " ").trim());
          buf = [];
        }
        buf.push(str);
        lastY = y;
        if (it.hasEOL) {
          lines.push(buf.join(" ").replace(/\s+/g, " ").trim());
          buf = [];
        }
      }
      if (buf.length) lines.push(buf.join(" ").replace(/\s+/g, " ").trim());
      parts.push(lines.filter(Boolean).join("\n"));
    }
    return parts.join("\n");
  } catch (e) {
    const err = new Error("PDF okunamadı. Taranmış PDF ise sayfayı JPG olarak kaydedip yükleyin.");
    err.status = 422;
    throw err;
  }
}

async function extractPdfEmbeddedImage(buffer) {
  let pdfjs;
  try {
    pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
  } catch {
    return null;
  }
  if (!sharp) return null;
  try {
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: true,
    });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const ops = await page.getOperatorList();
    const paintOps = new Set([
      pdfjs.OPS.paintImageXObject,
      pdfjs.OPS.paintInlineImageXObject,
      pdfjs.OPS.paintJpegXObject,
    ].filter(Boolean));
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (!paintOps.has(ops.fnArray[i])) continue;
      const name = ops.argsArray[i] && ops.argsArray[i][0];
      if (!name) continue;
      let img = null;
      try {
        img = await page.objs.get(name);
      } catch {
        try {
          img = await page.commonObjs.get(name);
        } catch {
          img = null;
        }
      }
      if (!img || !img.data || !img.width || !img.height) continue;
      const raw = Buffer.from(img.data);
      const pixels = img.width * img.height;
      const channels = raw.length >= pixels * 4 ? 4 : raw.length >= pixels * 3 ? 3 : 0;
      if (!channels) continue;
      return await sharp(raw, {
        raw: { width: img.width, height: img.height, channels },
      })
        .jpeg({ quality: 85 })
        .toBuffer();
    }
  } catch {
    return null;
  }
  return null;
}

async function preprocessImage(buffer) {
  if (!sharp) return buffer;
  try {
    return await sharp(buffer)
      .rotate()
      .resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true })
      .grayscale()
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch {
    return buffer;
  }
}

let ocrWorkerPromise = null;
let ocrQueue = Promise.resolve();

async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    const cachePath = path.join(os.tmpdir(), "cf-tess-cache");
    ocrWorkerPromise = Tesseract.createWorker("tur+eng", 1, {
      logger: () => {},
      cachePath,
    }).then(async (worker) => {
      await worker.setParameters({ tessedit_pageseg_mode: "6" });
      return worker;
    });
  }
  return ocrWorkerPromise;
}

async function runOcr(buffer) {
  const job = ocrQueue.then(async () => {
    const worker = await getOcrWorker();
    const { data } = await worker.recognize(buffer);
    return data.text || "";
  });
  ocrQueue = job.catch(() => {});
  return job;
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
    .replace(/\s+(?:total|subtotal|amount\s*due|balance\s*due|due\s*date|invoice\s*date|genel\s*toplam|vade|tarih)\b.*$/i, "")
    .replace(/[^\p{L}\d\s.&'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 3 || isNoiseName(cleaned)) return null;
  return cleaned.slice(0, 80);
}

function looksLikeDate(value) {
  return /^\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}$/.test(String(value || "").trim());
}

function extractLabeledValue(lines, labelPatterns) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of labelPatterns) {
      const re = new RegExp("(?:^|\\b)" + pattern + "\\s*[:.#]?\\s*(.*)$", "i");
      const m = line.match(re);
      if (!m) continue;
      let val = (m[1] || "").trim();
      if (!val || isNoiseName(val) || /^(number|no\.?|numaras[ıi])\b/i.test(val)) {
        const next = (lines[i + 1] || "").trim();
        if (next && next.length > 1 && next.length < 80 && !isNoiseName(next)) val = next;
        else continue;
      }
      if (isNoiseName(val)) continue;
      if (/^(bilgileri|adı|soyadı)\b/i.test(val)) continue;
      val = val.split(/\s+(?:Total|Subtotal|Amount Due|Balance Due|Due Date|Invoice Date|Genel Toplam|Vade|Tarih)\b/i)[0].trim();
      if (!val) continue;
      return val;
    }
  }
  return null;
}

function extractLabeledDate(lines, labelPatterns) {
  const val = extractLabeledValue(lines, labelPatterns);
  if (!val) return null;
  return extractDate(val) || extractDate(String(val).replace(/[^\d./-]+/g, " "));
}

function extractFaturaTuru(text) {
  const t = String(text || "");
  if (/e-?\s*ar[sş]iv/i.test(t)) return "E-Arşiv";
  if (/e-?\s*fatura/i.test(t)) return "E-Fatura";
  return null;
}

function extractSube(lines) {
  const value = extractLabeledValue(lines, [
    "[ŞS]ube\\s*Ad[ıi]",
    "Branch\\s*Name",
    "İşyeri\\s*Ad[ıi]",
    "[ŞS]ube",
    "Branch",
    "İşyeri",
  ]);
  if (!value) return null;
  const cleaned = String(value)
    .replace(/[^\p{L}\d\s.&'/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 2 || isNoiseName(cleaned)) return null;
  return cleaned.slice(0, 80);
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

function cleanFaturaNo(value) {
  if (!value) return null;
  let v = String(value).replace(/^[#:\-–]+\s*/, "").trim();
  v = v.replace(/\s+/g, " ");
  if (!v || isNoiseName(v) || looksLikeDate(v)) return null;
  if (v.length > 40) return null;
  if (/fatura\s*tarih|senaryo|fatura\s*tip|due\s*date|invoice\s*date/i.test(v)) return null;
  return v;
}

function extractFaturaNo(lines, text) {
  const labeled = extractLabeledValue(lines, [
    "Invoice\\s*Number",
    "Invoice\\s*No\\.?",
    "Fatura\\s*Numaras[ıi]",
    "Fatura\\s*No",
    "Fiş\\s*No",
    "Belge\\s*No",
    "Document\\s*No",
    "INV\\s*No\\.?",
    "Bill\\s*No\\.?",
    "ETTN",
    "Invoice\\s*#",
  ]);
  const cleaned = cleanFaturaNo(labeled);
  if (cleaned) return cleaned;

  const gib = String(text || "").match(/\b([A-Z]{3}\d{13})\b/);
  if (gib) return gib[1];
  const inv = String(text || "").match(/\b(INV[-/\s]?\d{2,12}(?:[-/]\d{1,12})?)\b/i);
  if (inv) return inv[1].replace(/\s+/g, "");
  const hash = String(text || "").match(/\binvoice\s*#\s*([A-Z0-9][-A-Z0-9/]{1,24})/i);
  if (hash) return cleanFaturaNo(hash[1]);
  return null;
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
    /TOTAL\s*[:.]?\s*(?:RM\s*)?([\d\s.,]+)/gi,
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

async function extractInvoiceFromDocument(fileBuffer, mimetype, originalname = "") {
  let text = "";
  const isPdf = mimetype === PDF_TYPE || /\.pdf$/i.test(originalname || "");

  if (isPdf) {
    try {
      text = await extractPdfText(fileBuffer);
    } catch (err) {
      if (err.status === 500) throw err;
      text = "";
    }
    if (!text || text.trim().length < 8) {
      const embedded = await extractPdfEmbeddedImage(fileBuffer);
      if (embedded) {
        try {
          text = await runOcr(await preprocessImage(embedded));
        } catch {
          text = "";
        }
      }
    }
    if (!text || text.trim().length < 8) {
      const err = new Error(
        "Bu PDF’den metin okunamadı (taranmış görüntü olabilir). Sayfayı JPG/PNG kaydedip yükleyin."
      );
      err.status = 422;
      throw err;
    }
  } else if (ALLOWED_OCR_TYPES.has(mimetype) || /\.(jpe?g|png|webp)$/i.test(originalname || "")) {
    let processed;
    try {
      processed = await preprocessImage(fileBuffer);
    } catch {
      processed = fileBuffer;
    }
    try {
      text = await runOcr(processed);
    } catch {
      const wrapped = new Error("Görüntü okunamadı (OCR başarısız oldu)");
      wrapped.status = 502;
      throw wrapped;
    }
  } else {
    const err = new Error("JPG, PNG, WEBP veya PDF yükleyin.");
    err.status = 400;
    throw err;
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
  const sube_adi = extractSube(lines);
  const fatura_turu = extractFaturaTuru(text);
  const tarih =
    extractLabeledDate(lines, [
      "Fatura\\s*Tarihi",
      "Kesim\\s*Tarihi",
      "Invoice\\s*Date",
      "Issue\\s*Date",
      "Tarih",
    ]) || extractDate(text);
  const vade_tarihi = extractLabeledDate(lines, [
    "Vade\\s*Tarihi",
    "Vade",
    "Due\\s*Date",
    "Payment\\s*Due",
    "[OÖ]deme\\s*Tarihi",
  ]);
  const fatura_no = extractFaturaNo(lines, text);

  let kalemler = extractKalemler(lines);
  if (kalemler.length === 0) {
    kalemler = buildFallbackKalem(text);
  }

  return {
    cari_adi,
    sube_adi,
    fatura_turu,
    tarih,
    vade_tarihi,
    fatura_no,
    fatura_notu: fatura_no ? "Kaynak belge no: " + fatura_no : null,
    kalemler,
    _raw_text: text,
  };
}

async function extractExpenseFromDocument(fileBuffer, mimetype, originalname = "") {
  const inv = await extractInvoiceFromDocument(fileBuffer, mimetype, originalname);
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
