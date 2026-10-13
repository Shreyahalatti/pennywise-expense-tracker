require("dotenv").config();

const path = require("node:path");
const express = require("express");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { rateLimit } = require("express-rate-limit");

const app = express();
const port = Number(process.env.PORT) || 3000;
const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must be set to a random value at least 32 characters long.");
}
if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI must be set. See .env.example.");
}

app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "16kb" }));

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true }
}, { timestamps: true });

const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "User", index: true },
  description: { type: String, required: true, trim: true, maxlength: 80 },
  amount: { type: Number, required: true, min: 0.01 },
  type: { type: String, required: true, enum: ["income", "expense"] },
  category: { type: String, required: true, enum: ["Food", "Transport", "Shopping", "Bills", "Health", "Entertainment", "Salary", "Other"] },
  date: { type: Date, required: true }
}, { timestamps: true });
transactionSchema.index({ userId: 1, date: -1 });

const budgetSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "User" },
  category: { type: String, required: true, enum: ["Food", "Transport", "Shopping", "Bills", "Health", "Entertainment", "Other"] },
  month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
  limit: { type: Number, required: true, min: 0.01 }
}, { timestamps: true });
budgetSchema.index({ userId: 1, category: 1, month: 1 }, { unique: true });

const User = mongoose.model("User", userSchema);
const Transaction = mongoose.model("Transaction", transactionSchema);
const Budget = mongoose.model("Budget", budgetSchema);

const categories = ["Food", "Transport", "Shopping", "Bills", "Health", "Entertainment", "Salary", "Other"];
const expenseCategories = categories.filter(category => category !== "Salary");
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Try again in 15 minutes." }
});

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) &&
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function monthBounds(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || "")) return null;
  const [year, monthNumber] = month.split("-").map(Number);
  return {
    start: new Date(Date.UTC(year, monthNumber - 1, 1)),
    end: new Date(Date.UTC(year, monthNumber, 1))
  };
}

function createToken(user) {
  return jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: process.env.JWT_EXPIRES_IN || "7d" });
}

const requireAuth = asyncRoute(async (req, res, next) => {
  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: "Sign in to continue." });
  try {
    const payload = jwt.verify(match[1], jwtSecret);
    const user = await User.findById(payload.sub).select("_id email");
    if (!user) return res.status(401).json({ error: "This account is no longer available." });
    req.user = user;
    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Your session has expired. Please sign in again." });
    }
    throw error;
  }
});

app.post("/api/auth/register", authLimiter, asyncRoute(async (req, res) => {
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: "Password must be between 8 and 128 characters." });
  }
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const user = await User.create({ email, passwordHash });
    return res.status(201).json({ token: createToken(user), user: { id: user.id, email: user.email } });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: "An account with this email already exists." });
    throw error;
  }
}));

app.post("/api/auth/login", authLimiter, asyncRoute(async (req, res) => {
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const user = await User.findOne({ email });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: "Email or password is incorrect." });
  }
  res.json({ token: createToken(user), user: { id: user.id, email: user.email } });
}));

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: { id: req.user.id, email: req.user.email } });
});

app.get("/api/transactions", requireAuth, asyncRoute(async (req, res) => {
  const query = { userId: req.user._id };
  const { startDate, endDate, category, type } = req.query;
  if (startDate && !isIsoDate(startDate)) return res.status(400).json({ error: "startDate must be a valid YYYY-MM-DD date." });
  if (endDate && !isIsoDate(endDate)) return res.status(400).json({ error: "endDate must be a valid YYYY-MM-DD date." });
  if (startDate && endDate && startDate > endDate) return res.status(400).json({ error: "startDate must be on or before endDate." });
  if (startDate || endDate) {
    query.date = {};
    if (startDate) query.date.$gte = new Date(`${startDate}T00:00:00.000Z`);
    if (endDate) query.date.$lt = new Date(new Date(`${endDate}T00:00:00.000Z`).getTime() + 86400000);
  }
  if (category) {
    if (!categories.includes(category)) return res.status(400).json({ error: "Unknown category." });
    query.category = category;
  }
  if (type) {
    if (!["income", "expense"].includes(type)) return res.status(400).json({ error: "type must be income or expense." });
    query.type = type;
  }
  const transactions = await Transaction.find(query).sort({ date: -1, createdAt: -1 }).limit(500).lean();
  res.json({ transactions });
}));

app.post("/api/transactions", requireAuth, asyncRoute(async (req, res) => {
  const { description, amount, type, category, date } = req.body;
  if (typeof description !== "string" || !description.trim() || description.trim().length > 80) {
    return res.status(400).json({ error: "Description must contain 1–80 characters." });
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > 100000000) {
    return res.status(400).json({ error: "Amount must be a positive number." });
  }
  if (!["income", "expense"].includes(type)) return res.status(400).json({ error: "Choose income or expense." });
  if (!categories.includes(category) || (type === "expense" && category === "Salary")) {
    return res.status(400).json({ error: "Choose a valid category for this transaction." });
  }
  if (!isIsoDate(date)) return res.status(400).json({ error: "Date must be a valid YYYY-MM-DD date." });
  const transaction = await Transaction.create({
    userId: req.user._id, description: description.trim(), amount, type, category,
    date: new Date(`${date}T12:00:00.000Z`)
  });
  res.status(201).json({ transaction });
}));

app.delete("/api/transactions/:id", requireAuth, asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid transaction ID." });
  const transaction = await Transaction.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
  if (!transaction) return res.status(404).json({ error: "Transaction not found." });
  res.status(204).end();
}));

app.get("/api/budgets", requireAuth, asyncRoute(async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  if (!monthBounds(month)) return res.status(400).json({ error: "month must use YYYY-MM format." });
  const budgets = await Budget.find({ userId: req.user._id, month }).sort({ category: 1 }).lean();
  res.json({ budgets });
}));

app.put("/api/budgets/:category", requireAuth, asyncRoute(async (req, res) => {
  const { category } = req.params;
  const { month, limit } = req.body;
  if (!expenseCategories.includes(category)) return res.status(400).json({ error: "Choose a valid expense category." });
  if (!monthBounds(month)) return res.status(400).json({ error: "month must use YYYY-MM format." });
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0 || limit > 100000000) {
    return res.status(400).json({ error: "Budget limit must be a positive number." });
  }
  const budget = await Budget.findOneAndUpdate(
    { userId: req.user._id, category, month },
    { $set: { limit } },
    { new: true, upsert: true, runValidators: true }
  );
  res.json({ budget });
}));

app.delete("/api/budgets/:category", requireAuth, asyncRoute(async (req, res) => {
  const { category } = req.params;
  const month = req.query.month;
  if (!expenseCategories.includes(category) || !monthBounds(month)) {
    return res.status(400).json({ error: "Provide a valid category and month=YYYY-MM." });
  }
  await Budget.findOneAndDelete({ userId: req.user._id, category, month });
  res.status(204).end();
}));

app.get("/api/dashboard", requireAuth, asyncRoute(async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const bounds = monthBounds(month);
  if (!bounds) return res.status(400).json({ error: "month must use YYYY-MM format." });
  const transactions = await Transaction.find({
    userId: req.user._id, date: { $gte: bounds.start, $lt: bounds.end }
  }).sort({ date: 1 }).lean();
  const budgets = await Budget.find({ userId: req.user._id, month }).lean();
  const income = transactions.filter(item => item.type === "income").reduce((sum, item) => sum + item.amount, 0);
  const expense = transactions.filter(item => item.type === "expense").reduce((sum, item) => sum + item.amount, 0);
  const categoriesByAmount = {};
  const daily = {};
  transactions.forEach(item => {
    const day = item.date.toISOString().slice(0, 10);
    daily[day] ||= { income: 0, expense: 0 };
    daily[day][item.type] += item.amount;
    if (item.type === "expense") categoriesByAmount[item.category] = (categoriesByAmount[item.category] || 0) + item.amount;
  });
  const budgetStatus = budgets.map(budget => {
    const spent = categoriesByAmount[budget.category] || 0;
    return { category: budget.category, limit: budget.limit, spent, overBudget: spent > budget.limit };
  }).sort((a, b) => Number(b.overBudget) - Number(a.overBudget) || b.spent / b.limit - a.spent / a.limit);
  res.json({
    month, totals: { income, expenses: expense, balance: income - expense },
    categories: Object.entries(categoriesByAmount).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    daily: Object.entries(daily).map(([date, values]) => ({ date, ...values })),
    budgets: budgetStatus,
    alerts: budgetStatus.filter(item => item.overBudget)
  });
}));

app.use("/api", (req, res) => res.status(404).json({ error: "API endpoint not found." }));
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  if (error.name === "ValidationError" || error.name === "CastError") {
    return res.status(400).json({ error: "The submitted data is invalid." });
  }
  if (error.name === "MongoServerError" && error.code === 11000) {
    return res.status(409).json({ error: "This record already exists." });
  }
  res.status(500).json({ error: "An unexpected server error occurred." });
});

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    app.listen(port, () => console.log(`Pennywise is running at http://localhost:${port}`));
  })
  .catch(error => {
    console.error("Could not connect to MongoDB:", error.message);
    process.exitCode = 1;
  });
