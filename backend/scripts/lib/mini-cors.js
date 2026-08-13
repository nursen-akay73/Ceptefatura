// TEST-ONLY sahte 'cors' — sadece no-op middleware döner. Üretimde KULLANILMAZ.
module.exports = function cors() {
  return function (_req, _res, next) {
    next();
  };
};
