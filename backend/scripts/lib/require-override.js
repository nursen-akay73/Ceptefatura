// TEST-ONLY: 'express' / 'cors' / 'bcryptjs' / 'jsonwebtoken' require() çağrılarını
// bu klasördeki sahte (mock) implementasyonlara yönlendirir — böylece app.js ve
// *.routes.js dosyaları TEK SATIR DEĞİŞTİRİLMEDEN, npm install yapılmadan test edilebilir.
//
// Sadece test-mock-integration.js tarafından require edilir. Üretim kodunda
// (src/**) hiçbir dosya bunu require etmez.
const Module = require("module");
const path = require("path");

const overrides = {
  express: path.join(__dirname, "mini-express.js"),
  cors: path.join(__dirname, "mini-cors.js"),
  bcryptjs: path.join(__dirname, "mini-bcryptjs.js"),
  jsonwebtoken: path.join(__dirname, "mini-jsonwebtoken.js"),
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function patchedResolveFilename(request, ...rest) {
  if (overrides[request]) return overrides[request];
  return originalResolveFilename.call(this, request, ...rest);
};
