const Iyzipay = require("iyzipay");

function isConfigured() {
  return Boolean(process.env.IYZICO_API_KEY && process.env.IYZICO_SECRET_KEY);
}

function getClient() {
  if (!isConfigured()) {
    const err = new Error(
      "iyzico API anahtarları tanımlı değil. backend/.env içine IYZICO_API_KEY ve IYZICO_SECRET_KEY ekleyin."
    );
    err.status = 503;
    throw err;
  }
  return new Iyzipay({
    apiKey: process.env.IYZICO_API_KEY,
    secretKey: process.env.IYZICO_SECRET_KEY,
    uri: process.env.IYZICO_BASE_URL || "https://sandbox-api.iyzipay.com",
  });
}

module.exports = { getClient, isConfigured };
