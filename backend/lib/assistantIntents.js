// Cepte Asistan için LLM kullanmayan, deterministik niyet (intent) ayrıştırıcı.
// Yalnızca gerçek veriye erişen ("kaç fatura kestim") ve yazma isteyen
// ("yeni fatura oluştur...") komutları hedefler. Eşleşmeyen her mesaj null
// döner ki frontend kendi genel SSS bilgi tabanına düşebilsin.

// Yalnızca Türkçe özel karakterleri ASCII karşılığına çevirir; String.prototype
// toLowerCase() kullanmaz çünkü 'İ' bazı motorlarda 2 code-unit'e büyüyüp
// index hizalamasını bozabilir. Her karakter 1:1 değiştiği için foldTr(s) ile
// s aynı uzunlukta kalır — extractAfterKeyword bu garantiye dayanır.
function foldTr(s) {
  return String(s || "")
    .replace(/İ/g, "i")
    .replace(/I/g, "i")
    .replace(/ı/g, "i")
    .replace(/Ğ/g, "g")
    .replace(/ğ/g, "g")
    .replace(/Ü/g, "u")
    .replace(/ü/g, "u")
    .replace(/Ş/g, "s")
    .replace(/ş/g, "s")
    .replace(/Ö/g, "o")
    .replace(/ö/g, "o")
    .replace(/Ç/g, "c")
    .replace(/ç/g, "c")
    .replace(/[A-Z]/g, (c) => c.toLowerCase());
}

// "5.000 TL", "5000TL", "1.250,50 ₺" gibi ifadelerden tutarı sayıya çevirir.
// Serbest metin ayrıştırma en iyi çaba prensibiyle çalışır: LLM olmadan
// karmaşık/belirsiz ifadeler yanlış yorumlanabilir, kullanıcı onay adımında
// tutarı görüp düzeltebilir.
function parseAmount(rawMessage) {
  const m = rawMessage.match(/(\d{1,3}(?:[.\s]\d{3})*(?:,\d+)?|\d+(?:[.,]\d+)?)\s*(?:tl|₺|lira)\b/i);
  if (!m) return null;
  let raw = m[1].replace(/\s/g, "");
  if (raw.includes(",")) {
    raw = raw.replace(/\./g, "").replace(",", ".");
  } else if ((raw.match(/\./g) || []).length > 1) {
    raw = raw.replace(/\./g, "");
  } else if (/^\d{1,3}\.\d{3}$/.test(raw)) {
    raw = raw.replace(/\./g, "");
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

// keywordRegex, foldTr(rawMessage) üzerinde eşleşir; foldTr uzunluk-koruyucu
// olduğundan bulunan index rawMessage'a da uygulanıp orijinal büyük/küçük
// harfler (isim vb.) korunur. Anahtar kelimeden sonraki tüm metni döner.
function extractRemainder(rawMessage, foldedMessage, keywordRegex) {
  const m = foldedMessage.match(keywordRegex);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = rawMessage.slice(start).trim();
  return rest || null;
}

// Müşteri/cari adı gibi tek bir alanı çıkarır: virgül, "tutar" veya para
// biriminden önceki kısmı alır.
function extractAfterKeyword(rawMessage, foldedMessage, keywordRegex) {
  const rest = extractRemainder(rawMessage, foldedMessage, keywordRegex);
  if (!rest) return null;
  const name = rest.split(/,|\btutar\b|\btl\b|₺/i)[0].trim();
  return name || null;
}

// Serbest açıklama metni çıkarır: tutar + para birimi ifadesini ve önündeki
// virgülü metinden temizleyip kalanı döner (örn. "500 TL kırtasiye" -> "kırtasiye").
function extractDescription(rawMessage, foldedMessage, keywordRegex) {
  const rest = extractRemainder(rawMessage, foldedMessage, keywordRegex);
  if (!rest) return null;
  const cleaned = rest
    .replace(/(\d{1,3}(?:[.\s]\d{3})*(?:,\d+)?|\d+(?:[.,]\d+)?)\s*(?:tl|₺|lira)\b/i, "")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .trim();
  return cleaned || null;
}

function classifyIntent(rawMessage) {
  const text = foldTr(rawMessage);

  if (/fatura/.test(text) && /(olustur|kes)/.test(text) && /musteri/.test(text)) {
    const amount = parseAmount(rawMessage);
    const customer = extractAfterKeyword(rawMessage, text, /musteri[sy]?\s+(?:adi\s*[:\-]?\s*)?/);
    if (amount && customer) {
      return { type: "create_invoice", customer, amount };
    }
  }

  if (/musteri\s+ekle/.test(text) || /cari\s+ekle/.test(text)) {
    const customer = extractAfterKeyword(rawMessage, text, /(?:musteri|cari)\s+ekle[,:]?\s*/);
    if (customer) return { type: "create_account", customer };
  }

  if (/gider/.test(text) && /(kaydet|ekle)/.test(text) && !/(bu ay|ayki)/.test(text)) {
    const amount = parseAmount(rawMessage);
    if (amount) {
      const description = extractDescription(rawMessage, text, /gider\s+(?:kaydet|ekle)[,:]?\s*/);
      return { type: "create_expense", amount, description };
    }
  }

  if (/kac\s+fatura/.test(text) || (/fatura/.test(text) && /kestim/.test(text))) {
    return { type: "count_invoices_this_month" };
  }
  if (/ciro/.test(text)) {
    return { type: "total_revenue" };
  }
  if (/fatura/.test(text) && /(odenmem|bekleyen|beklemede)/.test(text)) {
    return { type: "unpaid_invoices" };
  }
  if (/gider/.test(text) && /(bu ay|ayki)/.test(text)) {
    return { type: "expenses_this_month" };
  }

  return null;
}

module.exports = { foldTr, parseAmount, classifyIntent };
