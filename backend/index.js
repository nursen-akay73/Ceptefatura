const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const cors = require("cors");

const auth = require("./routes/auth");
const invoices = require("./routes/invoices");
const accounts = require("./routes/accounts");
const expenses = require("./routes/expenses");
const businesses = require("./routes/businesses");
const reports = require("./routes/reports");
const assistant = require("./routes/assistant");
const notifications = require("./routes/notifications");
const { UPLOAD_DIR } = require("./middleware/upload");
const { checkDbConnection, hasDatabaseUrl } = require("./db");
const { startReminderScheduler } = require("./services/reminders");

const FRONTEND = path.join(__dirname, "..", "frontend");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // iyzico ödeme callback'i form-urlencoded gönderir
app.use("/uploads", express.static(UPLOAD_DIR));

app.get("/api/health", async (_req, res) => {
  const db = await checkDbConnection();
  res.json({
    ok: true,
    db,
    env: {
      databaseConfigured: hasDatabaseUrl,
      jwtConfigured: Boolean(process.env.JWT_SECRET),
    },
  });
});

app.use("/api/auth", auth);
app.use("/api/invoices", invoices);
app.use("/api/accounts", accounts);
app.use("/api/expenses", expenses);
app.use("/api/businesses", businesses);
app.use("/api/reports", reports);
app.use("/api/assistant", assistant);
app.use("/api/notifications", notifications);

app.use(express.static(FRONTEND));
app.get("/", (_req, res) => {
  res.redirect("/pages/login.html");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Uygulama http://localhost:${PORT}`);

  const db = await checkDbConnection();
  if (db.ok) {
    console.log("PostgreSQL bağlantısı başarılı.");
    // Vadesi yaklaşan/geçen faturalar için hatırlatma taraması: açılışta bir
    // kez, sonra düzenli aralıklarla. Test/geliştirmede daha sık çalışsın
    // diye REMINDER_INTERVAL_MS ile ayarlanabilir (varsayılan: 1 saat).
    const interval = Number(process.env.REMINDER_INTERVAL_MS) || 60 * 60 * 1000;
    startReminderScheduler(interval);
  } else {
    console.warn(`PostgreSQL bağlantısı kurulamadı: ${db.reason}`);
    console.warn("Ekipte herkes backend/.env dosyasını kendi makinesinde oluşturmalı.");
  }
});
