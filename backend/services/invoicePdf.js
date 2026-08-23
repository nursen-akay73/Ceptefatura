const path = require("path");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");

// Türkiye'deki resmi e-Fatura çıktısının GÖRSEL düzenini (FIRMA / EFATURA
// CARİ blokları, ÖZELLEŞTİRME NO tablosu, ETTN, kalem tablosu, toplam
// tablosu, QR kod) taklit eden bir PDF üretir. ÖNEMLİ: bu, GİB'in gerçek
// e-Fatura entegratör sistemine bağlı DEĞİLDİR -- yalnızca müşteriye/arşive
// verilecek, aynı görünüme sahip bir çıktı belgesi üretir. ÖZELLEŞTİRME NO,
// FATURA TİPİ ve SENARYO alanları bu yüzden sabit/basitleştirilmiş
// değerlerle dolduruluyor.
//
// Koordinatlar Python/reportlab ile hazırlanan bir prototipte görsel olarak
// (PNG'ye render edilip incelenerek) doğrulandı, sonra pdfkit'e aynı sayılarla
// taşındı -- pdfkit de (reportlab'ın aksine) sayfanın SOL ÜST köşesini
// başlangıç kabul edip y'yi aşağı doğru artırdığından koordinatlarda
// dönüştürme gerekmedi.

const FONT_REGULAR = path.join(__dirname, "..", "assets", "fonts", "DejaVuSans.ttf");
const FONT_BOLD = path.join(__dirname, "..", "assets", "fonts", "DejaVuSans-Bold.ttf");
const LOGO_PATH = path.join(__dirname, "..", "assets", "img", "efatura-logo.png");

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 40;

function money(n) {
  return (
    Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " TL"
  );
}

function dateTr(d) {
  if (!d) return "-";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "-";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(dt.getDate())}-${pad(dt.getMonth() + 1)}-${dt.getFullYear()}`;
}

function timeTr(d) {
  const dt = d ? new Date(d) : new Date(0);
  if (Number.isNaN(dt.getTime())) return "00:00:00";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
}

// Bir hücre içeriğini, komşu hücrelere taşmaması için gerekirse sonuna "…"
// ekleyerek kırpar (doc üzerinde o an ayarlı font/punto ile ölçülür).
function fitText(doc, text, font, size, maxWidth) {
  text = String(text ?? "");
  doc.font(font).fontSize(size);
  if (doc.widthOfString(text) <= maxWidth) return text;
  const ell = "…";
  while (text && doc.widthOfString(text + ell) > maxWidth) {
    text = text.slice(0, -1);
  }
  return text ? text + ell : ell;
}

// pdfkit'te text(str, x, y) 'deki y, satırın TEPESİdir (reportlab'ın aksine
// taban çizgisi değil) -- bu yüzden burada satır içi hizalama, hücrenin
// üstünden küçük sabit bir boşluk (padTop) bırakmak kadar basit; taban
// çizgisi hesaplaması gerekmiyor.
function rowText(doc, x, rowTop, text, font, size, opts = {}) {
  const { padTop = 4, width, align } = opts;
  doc.font(font).fontSize(size);
  doc.text(text, x, rowTop + padTop, { width, align, lineBreak: false });
}

function sectionHeader(doc, x, yTop, w, title) {
  doc.lineWidth(1.6);
  doc.moveTo(x, yTop).lineTo(x + w, yTop).stroke();
  doc.font(FONT_BOLD).fontSize(11).text(title, x, yTop + 3, { lineBreak: false });
  doc.moveTo(x, yTop + 18).lineTo(x + w, yTop + 18).stroke();
}

function rect(doc, x, y, w, h) {
  doc.lineWidth(0.7);
  doc.rect(x, y, w, h).stroke();
}

async function buildInvoicePdf(data) {
  // data: { firma: {isletme_adi, adres, sehir, vergi_no, vergi_dairesi},
  //         cari: {cari_adi, adres, vergi_no, vergi_dairesi},
  //         fatura_no, fatura_turu, kesim_tarihi, created_at, ettn,
  //         kalemler: [{aciklama, miktar, birim_fiyat, kdv_orani}],
  //         iskonto (opsiyonel, varsayılan 0) }
  const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0 });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const leftX = MARGIN;
  const firmaW = 260;

  // ---- FIRMA ----
  let y = 40;
  sectionHeader(doc, leftX, y, firmaW, "FIRMA");
  y += 32;
  doc.font(FONT_BOLD).fontSize(10).text(data.firma.isletme_adi || "-", leftX, y, { lineBreak: false });
  y += 14;
  doc.font(FONT_REGULAR).fontSize(9);
  const firmaAdres = [data.firma.adres, data.firma.sehir].filter(Boolean).join(", ");
  doc.text("Adres: " + (firmaAdres || "-"), leftX, y, { lineBreak: false });
  y += 13;
  doc.text("VKN: " + (data.firma.vergi_no || "-"), leftX, y, { lineBreak: false });
  y += 13;
  doc.text("Vergi Dairesi: " + (data.firma.vergi_dairesi || "-"), leftX, y, { lineBreak: false });

  // ---- e-Fatura logosu (T.C. Hazine ve Maliye Bakanlığı - Gelir İdaresi
  // Başkanlığı amblemi; gerçek e-Fatura çıktılarının standart parçasıdır) ----
  const logoSize = 62;
  const logoX = 297 - logoSize / 2;
  const logoYTop = 32;
  doc.image(LOGO_PATH, logoX, logoYTop, { width: logoSize, height: logoSize });
  doc.font(FONT_BOLD).fontSize(9.5).text("e-Fatura", 167, logoYTop + logoSize + 6, { width: 260, align: "center", lineBreak: false });

  // ---- QR kod (sag ust) ----
  const qrSize = 95;
  const qrX = PAGE_W - MARGIN - qrSize;
  const qrYTop = 30;
  const qrPng = await QRCode.toBuffer(data.ettn, { type: "png", margin: 1, width: 300 });
  doc.image(qrPng, qrX, qrYTop, { width: qrSize, height: qrSize });

  // ---- ozellik tablosu (sag, ortada) ----
  const tblX = PAGE_W - MARGIN - 230;
  const tblW = 230;
  const tblY = 135;
  const ozellikRows = [
    ["ÖZELLEŞTİRME NO :", "TR1.2"],
    ["FATURA TİPİ :", "SATIS"],
    ["FATURA NO :", data.fatura_no],
    ["FATURA TARİHİ :", dateTr(data.kesim_tarihi)],
    ["FATURA ZAMANI :", timeTr(data.created_at)],
    ["SENARYO :", data.fatura_turu === "E-Arşiv" ? "TEMELFATURA" : "TICARIFATURA"],
  ];
  const ozRowH = 18;
  const labelW = 105;
  ozellikRows.forEach(([label, value], i) => {
    const ry = tblY + i * ozRowH;
    rect(doc, tblX, ry, labelW, ozRowH);
    rect(doc, tblX + labelW, ry, tblW - labelW, ozRowH);
    rowText(doc, tblX + 4, ry, label, FONT_BOLD, 7.5);
    rowText(doc, tblX + labelW + 5, ry, fitText(doc, value, FONT_REGULAR, 8, tblW - labelW - 8), FONT_REGULAR, 8);
  });
  const ozellikBottom = tblY + ozellikRows.length * ozRowH;

  // ---- EFATURA CARI ----
  const cariTop = 150;
  const cariW = 260;
  sectionHeader(doc, leftX, cariTop, cariW, "EFATURA CARİ");
  y = cariTop + 32;
  doc.font(FONT_BOLD).fontSize(10).text(data.cari.cari_adi || "-", leftX, y, { lineBreak: false });
  y += 14;
  doc.font(FONT_REGULAR).fontSize(9);
  doc.text("Adres: " + (data.cari.adres || "-"), leftX, y, { lineBreak: false });
  y += 13;
  doc.text("VKN: " + (data.cari.vergi_no || "-"), leftX, y, { lineBreak: false });
  y += 13;
  doc.text("Vergi Dairesi: " + (data.cari.vergi_dairesi || "-"), leftX, y, { lineBreak: false });
  y += 20;
  doc.text("Teslimat Adresi: " + (data.cari.adres || "-"), leftX, y, { lineBreak: false });
  y += 13;
  const cariBottom = y + 8;

  // ---- ETTN (CARI blogu ve ozellik tablosunun ALTINDA, cakismasin diye dinamik) ----
  const ettnY = Math.max(cariBottom, ozellikBottom) + 14;
  doc.font(FONT_BOLD).fontSize(8.5).text("ETTN: " + data.ettn, leftX, ettnY, { lineBreak: false });

  // ---- kalem tablosu ----
  const tableTop = ettnY + 18;
  const tableX = leftX;
  const tableW = PAGE_W - 2 * MARGIN;
  const fixedCols = [
    ["#", 16], ["Stok Kodu", 34], ["Mal / Hizmet", 100], ["Miktar", 36],
    ["Birim Fiyat", 52], ["İsk.Oranı", 38], ["İsk.Tutarı", 44],
    ["KDV %", 32], ["KDV Tutar", 44], ["Diğer Verg.", 44],
  ];
  const fixedTotal = fixedCols.reduce((s, [, w]) => s + w, 0);
  const cols = [...fixedCols, ["Tutar", tableW - fixedTotal]];

  const headerH = 20;
  let x = tableX;
  for (const [name, w] of cols) {
    rect(doc, x, tableTop, w, headerH);
    const headerFit = fitText(doc, name, FONT_BOLD, 6.5, w - 4);
    rowText(doc, x + 2, tableTop, headerFit, FONT_BOLD, 6.5, { padTop: 6 });
    x += w;
  }

  const rowH2 = 18;
  const kalemler = data.kalemler || [];
  // İskonto, KDV'den ÖNCE net tutardan düşülür: önce miktar*birim_fiyat net
  // tutarı bulunur, ondan iskonto_orani düşülür, KDV bu iskontolu tutar
  // üzerinden hesaplanır (backend/routes/invoices.js -> kalemTutar ile aynı
  // mantık, PDF'te de aynı sonucu göstermek için burada tekrar hesaplanıyor).
  const kalemHesap = kalemler.map((k) => {
    const miktar = Number(k.miktar || 1);
    const birim = Number(k.birim_fiyat || 0);
    const kdvOrani = Number(k.kdv_orani ?? 20);
    const iskontoOrani = Number(k.iskonto_orani || 0);
    const net = Math.round(miktar * birim * 100) / 100;
    const iskontoTutar = Math.round(net * (iskontoOrani / 100) * 100) / 100;
    const netIskontolu = Math.round((net - iskontoTutar) * 100) / 100;
    const kdvTutar = Math.round(netIskontolu * (kdvOrani / 100) * 100) / 100;
    return {
      ...k, miktar, birim, kdvOrani, iskontoOrani, net, iskontoTutar, netIskontolu,
      kdvTutar, brut: Math.round((netIskontolu + kdvTutar) * 100) / 100,
    };
  });

  kalemHesap.forEach((item, ridx) => {
    const ry = tableTop + headerH + ridx * rowH2;
    let cx = tableX;
    const vals = [
      String(ridx + 1),
      item.stok_kodu || String(ridx + 1).padStart(2, "0"),
      item.aciklama,
      `${item.miktar} Adet`,
      money(item.birim).replace(" TL", "TL"),
      `%${item.iskontoOrani.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}`,
      money(item.iskontoTutar).replace(" TL", "TL"),
      `%${item.kdvOrani.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}`,
      money(item.kdvTutar).replace(" TL", "TL"),
      item.diger_vergiler || "",
      money(item.brut).replace(" TL", "TL"),
    ];
    cols.forEach(([, w], ci) => {
      rect(doc, cx, ry, w, rowH2);
      const clipped = fitText(doc, vals[ci], FONT_REGULAR, 7, w - 5);
      rowText(doc, cx + 2, ry, clipped, FONT_REGULAR, 7, { padTop: 5 });
      cx += w;
    });
  });

  const itemsBottom = tableTop + headerH + kalemHesap.length * rowH2;

  // ---- Aciklama kutusu ----
  const acikTop = itemsBottom + 8;
  const acikH = 34;
  rect(doc, tableX, acikTop, tableW, acikH);
  rowText(doc, tableX + 5, acikTop, "Açıklama:", FONT_BOLD, 8, { padTop: 4 });
  if (data.fatura_notu) {
    rowText(doc, tableX + 5, acikTop + 14, fitText(doc, data.fatura_notu, FONT_REGULAR, 8, tableW - 10), FONT_REGULAR, 8, { padTop: 4 });
  }

  // ---- toplam tablosu (sag alt) ----
  const araToplam = kalemHesap.reduce((s, k) => s + k.net, 0);
  const iskonto = kalemHesap.reduce((s, k) => s + k.iskontoTutar, 0);
  const kdvToplam = kalemHesap.reduce((s, k) => s + k.kdvTutar, 0);
  const genelToplam = Math.round((araToplam - iskonto + kdvToplam) * 100) / 100;
  const kdvOranlari = [...new Set(kalemHesap.map((k) => k.kdvOrani))];
  const kdvLabel = kdvOranlari.length === 1
    ? `Hesaplanan KDV(%${kdvOranlari[0].toLocaleString("tr-TR", { minimumFractionDigits: 0 })})`
    : "Hesaplanan KDV";

  const sumTop = acikTop + acikH + 12;
  const sumW = 260;
  const sumX = PAGE_W - MARGIN - sumW;
  const labelW2 = 165;
  const sumRows = [
    ["Mal Hizmet Toplam Tutarı", money(araToplam)],
    ["Toplam İskonto", money(iskonto)],
    [kdvLabel, money(kdvToplam)],
    ["Vergiler Dahil Toplam Tutar", money(genelToplam)],
    ["Ödenecek Tutar", money(genelToplam)],
  ];
  const rh = 18;
  sumRows.forEach(([label, val], i) => {
    const ry = sumTop + i * rh;
    rect(doc, sumX, ry, labelW2, rh);
    rect(doc, sumX + labelW2, ry, sumW - labelW2, rh);
    const bold = label === "Ödenecek Tutar";
    const font = bold ? FONT_BOLD : FONT_REGULAR;
    rowText(doc, sumX + 4, ry, label, font, 8);
    rowText(doc, sumX + labelW2, ry, val, font, 8, { width: sumW - labelW2 - 5, align: "right" });
  });

  const footerTop = sumTop + sumRows.length * rh + 20;
  rect(doc, tableX, footerTop, tableW, 22);

  doc.end();
  return done;
}

module.exports = { buildInvoicePdf };
