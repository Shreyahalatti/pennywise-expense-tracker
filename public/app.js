(() => {
  "use strict";

  const TOKEN_KEY = "pennywise-token";
  const categoryInfo = {
    Food: ["◉", "#f8ede1", "#bb8052"],
    Transport: ["↗", "#e7eff8", "#6287b0"],
    Shopping: ["◇", "#f7e9ed", "#b86e83"],
    Bills: ["⌂", "#eeebf7", "#8071ad"],
    Health: ["+", "#e6f1ed", "#5c977d"],
    Entertainment: ["♪", "#f5edf8", "#9a78ad"],
    Salary: ["↗", "#e8f2e9", "#548365"],
    Other: ["•", "#eef0ec", "#777f76"]
  };
  const categories = Object.keys(categoryInfo);
  const expenseCategories = categories.filter(category => category !== "Salary");
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const $ = selector => document.querySelector(selector);
  let token = localStorage.getItem(TOKEN_KEY);
  let user = null;
  let isRegistering = false;
  let transactions = [];
  let budgets = [];

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  async function api(url, options = {}) {
    const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers };
    const response = await fetch(url, { ...options, headers });
    if (response.status === 204) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && token) signOut();
      throw new Error(data.error || "Something went wrong. Please try again.");
    }
    return data;
  }

  function displayAuth() {
    $("#auth-screen").classList.remove("hidden");
    $("#app").classList.add("hidden");
  }

  function showApp() {
    $("#auth-screen").classList.add("hidden");
    $("#app").classList.remove("hidden");
    $("#profile-email").textContent = user.email;
    $("#avatar").textContent = user.email.slice(0, 2).toUpperCase();
    loadDashboard().catch(showDashboardError);
  }

  function signOut() {
    localStorage.removeItem(TOKEN_KEY);
    token = null;
    user = null;
    displayAuth();
  }

  function setAuthMode(registering) {
    isRegistering = registering;
    $("#auth-title").textContent = registering ? "Create your account" : "Welcome back";
    $("#auth-copy").textContent = registering ? "A clearer picture of your money starts here." : "Sign in to see where your money goes.";
    $("#auth-switch-text").textContent = registering ? "Already have an account?" : "New to Pennywise?";
    $("#auth-switch").textContent = registering ? "Sign in" : "Create an account";
    $("#auth-form button[type=submit]").textContent = registering ? "Create account" : "Sign in";
    $("#auth-password").autocomplete = registering ? "new-password" : "current-password";
    $("#auth-error").textContent = "";
  }

  function monthValue() {
    return $("#month-select").value || new Date().toISOString().slice(0, 7);
  }

  function expenseDateRange() {
    const [year, month] = monthValue().split("-").map(Number);
    return {
      start: `${year}-${String(month).padStart(2, "0")}-01`,
      end: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
    };
  }

  function visibleTransactions() {
    const query = $("#search-input").value.trim().toLowerCase();
    const category = $("#category-filter").value;
    const start = $("#start-date").value;
    const end = $("#end-date").value;
    return transactions.filter(item =>
      (!category || item.category === category) &&
      (!start || item.date.slice(0, 10) >= start) &&
      (!end || item.date.slice(0, 10) <= end) &&
      `${item.description} ${item.category}`.toLowerCase().includes(query)
    );
  }

  async function loadDashboard() {
    $("#dashboard-error").classList.add("hidden");
    const month = monthValue();
    const range = expenseDateRange();
    const params = new URLSearchParams({ startDate: range.start, endDate: range.end });
    const [dashboard, transactionResult, budgetResult] = await Promise.all([
      api(`/api/dashboard?month=${encodeURIComponent(month)}`),
      api(`/api/transactions?${params}`),
      api(`/api/budgets?month=${encodeURIComponent(month)}`)
    ]);
    transactions = transactionResult.transactions;
    budgets = budgetResult.budgets;
    renderDashboard(dashboard);
  }

  function showDashboardError(error) {
    $("#dashboard-error").textContent = error.message;
    $("#dashboard-error").classList.remove("hidden");
  }

  function renderDashboard(data) {
    $("#balance-value").textContent = money.format(data.totals.balance);
    $("#income-value").textContent = money.format(data.totals.income);
    $("#expense-value").textContent = money.format(data.totals.expenses);
    $("#income-foot").textContent = `${transactions.filter(item => item.type === "income").length} income transaction(s) this month`;
    $("#expense-foot").textContent = `${transactions.filter(item => item.type === "expense").length} expense transaction(s) this month`;
    renderChart(data.daily, monthValue());
    renderCategories(data.categories, data.totals.expenses);
    renderBudgets(data.budgets);
    renderAlerts(data.alerts);
    renderTransactions();
  }

  function renderChart(daily, month) {
    const svg = $("#cashflow-chart");
    const [year, monthNumber] = month.split("-").map(Number);
    const daysInMonth = new Date(year, monthNumber, 0).getDate();
    const groupCount = Math.min(6, Math.ceil(daysInMonth / 5));
    const groups = Array.from({ length: groupCount }, (_, index) => {
      const start = Math.floor(index * daysInMonth / groupCount);
      const end = Math.floor((index + 1) * daysInMonth / groupCount);
      const totals = daily.filter(day => {
        const dayNumber = Number(day.date.slice(8, 10)) - 1;
        return dayNumber >= start && dayNumber < end;
      }).reduce((acc, day) => ({ income: acc.income + day.income, expense: acc.expense + day.expense }), { income: 0, expense: 0 });
      return { label: `${start + 1}`, ...totals };
    });
    const max = Math.max(500, ...groups.map(group => Math.max(group.income, group.expense))) * 1.12;
    const width = 520, height = 210, left = 38, right = 7, top = 12, bottom = 25;
    const chartHeight = height - top - bottom;
    const slot = (width - left - right) / groups.length;
    const barWidth = Math.min(17, slot * .23);
    let markup = `<title>Cash flow for ${escapeHtml(month)}</title>`;
    for (let index = 0; index <= 4; index++) {
      const value = max * index / 4;
      const y = top + chartHeight - value / max * chartHeight;
      const label = value >= 1000 ? `$${(value / 1000).toFixed(value % 1000 ? 1 : 0)}k` : `$${Math.round(value)}`;
      markup += `<line class="gridline" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"/><text class="chart-label" x="${left - 7}" y="${y + 3}" text-anchor="end">${label}</text>`;
    }
    groups.forEach((group, index) => {
      const center = left + index * slot + slot / 2;
      const incomeHeight = group.income / max * chartHeight;
      const expenseHeight = group.expense / max * chartHeight;
      markup += `<rect class="bar-income" x="${center - barWidth - 2}" y="${top + chartHeight - incomeHeight}" width="${barWidth}" height="${Math.max(incomeHeight, group.income ? 2 : 0)}"><title>${group.label}: ${money.format(group.income)} income</title></rect>`;
      markup += `<rect class="bar-expense" x="${center + 2}" y="${top + chartHeight - expenseHeight}" width="${barWidth}" height="${Math.max(expenseHeight, group.expense ? 2 : 0)}"><title>${group.label}: ${money.format(group.expense)} expenses</title></rect>`;
      markup += `<text class="chart-label" x="${center}" y="${height - 5}" text-anchor="middle">${group.label}</text>`;
    });
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.innerHTML = markup;
  }

  function renderCategories(items, total) {
    const holder = $("#category-list");
    if (!items.length) {
      holder.innerHTML = '<div class="empty-category">No expenses recorded for this month yet.</div>';
      return;
    }
    holder.innerHTML = items.slice(0, 5).map(item => {
      const [icon, color, ink] = categoryInfo[item.category] || categoryInfo.Other;
      const percent = total ? item.amount / total * 100 : 0;
      return `<div class="category-row"><span class="category-icon" style="background:${color};color:${ink}" aria-hidden="true">${icon}</span><div class="category-meta"><div class="category-name">${escapeHtml(item.category)}</div><div class="category-track"><div class="category-fill" style="width:${percent}%;background:${ink}"></div></div></div><div><div class="category-amount">${money.format(item.amount)}</div><div class="category-pct">${Math.round(percent)}% of spending</div></div></div>`;
    }).join("");
  }

  function renderBudgets(items) {
    const holder = $("#budget-list");
    if (!items.length) {
      holder.innerHTML = "";
      return;
    }
    holder.innerHTML = items.map(item => {
      const percent = Math.min(item.spent / item.limit * 100, 100);
      return `<div class="budget-item"><div class="budget-line"><strong>${escapeHtml(item.category)}</strong><span>${money.format(item.spent)} / ${money.format(item.limit)}</span></div><div class="budget-track" role="progressbar" aria-label="${escapeHtml(item.category)} budget used" aria-valuemin="0" aria-valuemax="${item.limit}" aria-valuenow="${item.spent}"><div class="budget-fill ${item.overBudget ? "over" : ""}" style="width:${percent}%"></div></div><div class="budget-caption ${item.overBudget ? "budget-alert" : ""}">${item.overBudget ? `Over budget by ${money.format(item.spent - item.limit)}` : `${money.format(item.limit - item.spent)} left`}</div></div>`;
    }).join("");
  }

  function renderAlerts(items) {
    $("#budget-alerts").innerHTML = items.map(item =>
      `<div class="alert" role="status"><strong>${escapeHtml(item.category)} budget exceeded.</strong> You're ${money.format(item.spent - item.limit)} over your ${money.format(item.limit)} limit this month.</div>`
    ).join("");
  }

  function renderTransactions() {
    const filtered = visibleTransactions().sort((a, b) => b.date.localeCompare(a.date) || b._id.localeCompare(a._id));
    $("#transaction-body").innerHTML = filtered.slice(0, 100).map(item => {
      const [icon, color, ink] = categoryInfo[item.category] || categoryInfo.Other;
      const date = new Date(item.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
      return `<tr><td><div class="merchant"><span class="merchant-icon" style="background:${color};color:${ink}" aria-hidden="true">${icon}</span>${escapeHtml(item.description)}</div></td><td class="transaction-category">${escapeHtml(item.category)}</td><td class="date-cell">${date}</td><td class="amount ${item.type === "income" ? "income" : ""}">${item.type === "income" ? "+" : "−"}${money.format(item.amount)}</td><td><button class="delete-button" type="button" data-delete="${item._id}" aria-label="Delete ${escapeHtml(item.description)}" title="Delete transaction">×</button></td></tr>`;
    }).join("");
    $("#empty-state").classList.toggle("hidden", filtered.length > 0);
    $("#transaction-count").textContent = `Showing ${Math.min(filtered.length, 100)}${filtered.length > 100 ? " of" : " of"} ${filtered.length} transaction${filtered.length === 1 ? "" : "s"}`;
  }

  function fillCategoryOptions() {
    $("#category-filter").innerHTML = '<option value="">All categories</option>' + categories.map(category => `<option value="${category}">${category}</option>`).join("");
    $("#transaction-category").innerHTML = categories.map(category => `<option value="${category}">${category}</option>`).join("");
    $("#budget-category").innerHTML = expenseCategories.map(category => `<option value="${category}">${category}</option>`).join("");
  }

  function openModal(id) {
    $(id).classList.remove("hidden");
    const firstInput = $(id).querySelector("input,select");
    if (firstInput) firstInput.focus();
  }

  function closeModal(id) {
    $(id).classList.add("hidden");
  }

  $("#auth-switch").addEventListener("click", () => setAuthMode(!isRegistering));
  $("#auth-form").addEventListener("submit", async event => {
    event.preventDefault();
    $("#auth-error").textContent = "";
    const submit = $("#auth-form button[type=submit]");
    submit.disabled = true;
    try {
      const response = await fetch(`/api/auth/${isRegistering ? "register" : "login"}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: $("#auth-email").value, password: $("#auth-password").value })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to sign in.");
      token = data.token;
      user = data.user;
      localStorage.setItem(TOKEN_KEY, token);
      showApp();
    } catch (error) {
      $("#auth-error").textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });

  $("#sign-out").addEventListener("click", signOut);
  $("#month-select").addEventListener("change", () => {
    const { start, end } = expenseDateRange();
    $("#start-date").value = start;
    $("#end-date").value = end;
    loadDashboard().catch(showDashboardError);
  });
  ["search-input", "category-filter", "start-date", "end-date"].forEach(id => {
    $(`#${id}`).addEventListener(id === "search-input" ? "input" : "change", renderTransactions);
  });
  $("#transaction-type").addEventListener("change", event => {
    const isIncome = event.target.value === "income";
    $("#transaction-category").innerHTML = (isIncome ? ["Salary", "Other"] : expenseCategories).map(category => `<option value="${category}">${category}</option>`).join("");
  });
  $("#add-button").addEventListener("click", () => {
    $("#transaction-error").textContent = "";
    $("#transaction-form").reset();
    const todayValue = new Date().toISOString().slice(0, 10);
    $("#transaction-form [name=date]").value = monthValue() === todayValue.slice(0, 7) ? todayValue : `${monthValue()}-01`;
    $("#transaction-type").dispatchEvent(new Event("change"));
    openModal("#modal-backdrop");
  });
  $("#close-modal").addEventListener("click", () => closeModal("#modal-backdrop"));
  $("#modal-backdrop").addEventListener("click", event => { if (event.target.id === "modal-backdrop") closeModal("#modal-backdrop"); });
  $("#transaction-form").addEventListener("submit", async event => {
    event.preventDefault();
    $("#transaction-error").textContent = "";
    const form = new FormData(event.currentTarget);
    const transaction = {
      description: form.get("description"),
      amount: Number(form.get("amount")),
      type: form.get("type"),
      category: form.get("category"),
      date: form.get("date")
    };
    try {
      await api("/api/transactions", { method: "POST", body: JSON.stringify(transaction) });
      $("#month-select").value = transaction.date.slice(0, 7);
      const range = expenseDateRange();
      $("#start-date").value = range.start;
      $("#end-date").value = range.end;
      closeModal("#modal-backdrop");
      await loadDashboard();
    } catch (error) {
      $("#transaction-error").textContent = error.message;
    }
  });
  $("#transaction-body").addEventListener("click", async event => {
    const button = event.target.closest("[data-delete]");
    if (!button || !confirm("Delete this transaction?")) return;
    try {
      await api(`/api/transactions/${encodeURIComponent(button.dataset.delete)}`, { method: "DELETE" });
      await loadDashboard();
    } catch (error) {
      showDashboardError(error);
    }
  });
  $("#budget-button").addEventListener("click", () => {
    $("#budget-error").textContent = "";
    $("#budget-month-copy").textContent = `This budget applies to ${new Date(`${monthValue()}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" })}.`;
    openModal("#budget-backdrop");
  });
  $("#close-budget").addEventListener("click", () => closeModal("#budget-backdrop"));
  $("#budget-backdrop").addEventListener("click", event => { if (event.target.id === "budget-backdrop") closeModal("#budget-backdrop"); });
  $("#budget-form").addEventListener("submit", async event => {
    event.preventDefault();
    $("#budget-error").textContent = "";
    const form = new FormData(event.currentTarget);
    try {
      await api(`/api/budgets/${encodeURIComponent(form.get("category"))}`, {
        method: "PUT", body: JSON.stringify({ month: monthValue(), limit: Number(form.get("limit")) })
      });
      closeModal("#budget-backdrop");
      await loadDashboard();
    } catch (error) {
      $("#budget-error").textContent = error.message;
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeModal("#modal-backdrop");
      closeModal("#budget-backdrop");
    }
  });

  fillCategoryOptions();
  const today = new Date();
  $("#today-label").textContent = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }).toUpperCase();
  $("#month-select").value = today.toISOString().slice(0, 7);
  const initialRange = expenseDateRange();
  $("#start-date").value = initialRange.start;
  $("#end-date").value = initialRange.end;
  $("#transaction-type").dispatchEvent(new Event("change"));

  if (token) {
    api("/api/auth/me").then(result => { user = result.user; showApp(); })
      .catch(() => { if (token) displayAuth(); });
  } else {
    displayAuth();
  }
})();
