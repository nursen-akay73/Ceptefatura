const path = require("path");
const multer = require("multer");

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "..", "uploads");
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".bin";
    cb(null, `fis_${req.userId}_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const okExt = [".jpg", ".jpeg", ".png", ".webp", ".pdf"].includes(ext);
    if (ALLOWED.has(file.mimetype) || okExt) return cb(null, true);
    cb(new Error("Sadece JPG, PNG, WEBP veya PDF yüklenebilir"));
  },
});

module.exports = { upload, UPLOAD_DIR };
