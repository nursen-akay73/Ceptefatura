const express = require("express");
const cors = require("cors");

const authRoutes = require("./modules/auth/auth.routes");
const invoiceRoutes = require("./modules/invoices/invoices.routes");
const accountRoutes = require("./modules/accounts/accounts.routes");
const expenseRoutes = require("./modules/expenses/expenses.routes");
const dashboardRoutes = require("./modules/dashboard/dashboard.routes");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "ceptefatura-api" });
});

app.use("/api/auth", authRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/accounts", accountRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/dashboard", dashboardRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: "Endpoint bulunamadı" });
});

module.exports = app;
