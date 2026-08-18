require("dotenv").config();
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");

const auth = require("./routes/auth");
const invoices = require("./routes/invoices");
const accounts = require("./routes/accounts");
const expenses = require("./routes/expenses");
const { UPLOAD_DIR } = require("./middleware/upload");

const FRONTEND = path.join(__dirname, "..", "frontend");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(UPLOAD_DIR));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/auth", auth);
app.use("/api/invoices", invoices);
app.use("/api/accounts", accounts);
app.use("/api/expenses", expenses);

app.use(express.static(FRONTEND));
app.get("/", (_req, res) => {
  res.redirect("/pages/login.html");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Uygulama http://localhost:${PORT}`));
