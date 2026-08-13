// HTTP status kodu taşıyan hata sınıfı. throw new ApiError(400, "mesaj") gibi kullanılır,
// asyncHandler bunu yakalayıp app.js'teki merkezi hata middleware'ine iletir.
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = ApiError;
