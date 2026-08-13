// Express route handler'larındaki async hataları merkezi hata middleware'ine iletir.
// Her route'ta tekrar tekrar try/catch yazmamak için kullanılır.
module.exports = function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
