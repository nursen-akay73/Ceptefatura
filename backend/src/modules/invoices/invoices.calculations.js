const ApiError = require("../../utils/apiError");

// Para hesaplarında float hatası olmasın diye kuruş bazında yuvarlıyoruz.
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Fatura kalemlerini doğrular, KDV dahil satır tutarlarını ve genel toplamı
// backend'de hesaplar (frontend sadece görüntüler — güvenlik gereği, hesaplama
// istemci tarafına bırakılmaz).
function calculateTotals(kalemler) {
  let toplam = 0;
  const items = kalemler.map((k) => {
    const miktar = Number(k.miktar);
    const birim_fiyat = Number(k.birim_fiyat);
    const kdv_orani = Number(k.kdv_orani);

    if (
      !k.aciklama ||
      !Number.isFinite(miktar) ||
      miktar <= 0 ||
      !Number.isFinite(birim_fiyat) ||
      birim_fiyat < 0 ||
      !Number.isFinite(kdv_orani) ||
      kdv_orani < 0
    ) {
      throw new ApiError(
        400,
        "Her kalemde aciklama, miktar (>0), birim_fiyat (>=0), kdv_orani (>=0) olmalı"
      );
    }

    const araToplam = miktar * birim_fiyat;
    const kdvTutari = araToplam * (kdv_orani / 100);
    const satirTutari = round2(araToplam + kdvTutari);
    toplam += satirTutari;

    return { aciklama: k.aciklama, miktar, birim_fiyat, kdv_orani, tutar: satirTutari };
  });

  return { items, tutar: round2(toplam) };
}

module.exports = { round2, calculateTotals };
