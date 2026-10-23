import * as db from "./db.js";

const DEFAULT_MEMBERS = ["אבא", "אמא", "", ""];
const CATEGORIES = ["סופר", "דלק ותחבורה", "בילויים ומסעדות", "ביגוד", "בית", "בריאות", "חינוך וחוגים", "מתנות", "אחר"];
const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

const app = document.getElementById("app");
const state = {
  familyId: null,
  family: null,
  me: null,
  month: currentMonth(),
  data: null,
  unsubscribe: null,
  category: CATEGORIES[0],
  breakdown: "category",
  editingBudget: false
};

// ---------- עזרים ----------

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { return null; }
}

function pad(n) { return String(n).padStart(2, "0"); }
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function currentMonth() { return today().slice(0, 7); }
function shiftMonth(month, delta) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
function monthName(month) {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
function daysLeft(month) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return last - new Date().getDate() + 1;
}
function shortDate(date) {
  const [, m, d] = date.split("-").map(Number);
  return `${d}.${m}`;
}
const fmt = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 2 });
function money(n) { return `₪${fmt.format(n)}`; }
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 24);
}
function joinLink() {
  return `${location.origin}${location.pathname}#f=${state.familyId}`;
}

let toastTimer;
function toast(text) {
  const el = document.getElementById("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2500);
}

function isSetter() { return state.family && state.me === state.family.budgetSetter; }

// ---------- מסכים ----------

function renderSetup() {
  app.innerHTML = `
    <h1>התקציב המשפחתי</h1>
    <p class="muted">מגדירים פעם אחת את בני המשפחה, ואז שולחים לכולם קישור הצטרפות.</p>
    <form class="card" id="setup">
      <h2>מי במשפחה?</h2>
      <p class="small muted">השם הראשון הוא מי שמגדיר את התקציב בכל 1 לחודש.</p>
      ${DEFAULT_MEMBERS.map((name, i) => `
        <label for="m${i}">${i === 0 ? "מגדיר/ת התקציב" : `בן/בת משפחה ${i + 1}`}</label>
        <input id="m${i}" value="${esc(name)}" placeholder="שם" ${i < 2 ? "required" : ""} maxlength="20">
      `).join("")}
      <button class="btn" type="submit">יצירת המשפחה</button>
    </form>
    <p class="small muted">קיבלת קישור מבן משפחה? פשוט פותחים אותו, אין צורך למלא כאן כלום.</p>
  `;
  document.getElementById("setup").addEventListener("submit", async (e) => {
    e.preventDefault();
    const members = DEFAULT_MEMBERS.map((_, i) => document.getElementById(`m${i}`).value.trim()).filter(Boolean);
    if (new Set(members).size !== members.length) { toast("כל שם צריך להיות שונה"); return; }
    e.submitter.disabled = true;
    const id = randomId();
    try {
      await db.createFamily(id, members);
      state.familyId = id;
      store("familyId", id);
      state.family = { members, budgetSetter: members[0] };
      renderPickUser();
    } catch (err) {
      console.error(err);
      toast("משהו השתבש, נסו שוב");
      e.submitter.disabled = false;
    }
  });
}

function renderPickUser() {
  app.innerHTML = `
    <h1>מי את/ה?</h1>
    <p class="muted">המכשיר יזכור את הבחירה.</p>
    <div class="people">
      ${state.family.members.map((m) => `
        <button class="person" data-name="${esc(m)}">${esc(m)}
          ${m === state.family.budgetSetter ? "<small>מגדיר/ת התקציב</small>" : ""}
        </button>`).join("")}
    </div>
  `;
  app.querySelectorAll(".person").forEach((b) => b.addEventListener("click", () => {
    state.me = b.dataset.name;
    store("me", state.me);
    startMonth();
  }));
}

function startMonth() {
  if (state.unsubscribe) state.unsubscribe();
  state.data = null;
  state.editingBudget = false;
  renderMain();
  state.unsubscribe = db.watchMonth(state.familyId, state.month, (data) => {
    state.data = data;
    renderMain();
  });
}

function renderMain() {
  const month = state.month;
  const isCurrent = month === currentMonth();
  const data = state.data;

  const top = `
    <div class="topbar">
      <div class="month-nav">
        <button class="icon-btn" id="prev" aria-label="חודש קודם">›</button>
        <span class="month-title">${monthName(month)}</span>
        <button class="icon-btn" id="next" aria-label="חודש הבא" ${isCurrent ? "disabled" : ""}>‹</button>
      </div>
      <button class="who" id="switch">👤 ${esc(state.me)}</button>
    </div>`;

  if (!data) {
    app.innerHTML = top + `<div class="loading">טוען…</div>`;
    bindTop();
    return;
  }

  const budget = data.budget ? data.budget.amount : null;
  const expenses = [...data.expenses].sort((a, b) =>
    b.date.localeCompare(a.date) || (b.createdAt?.seconds ?? Infinity) - (a.createdAt?.seconds ?? Infinity));
  const spent = expenses.reduce((s, e) => s + e.amount, 0);

  let html = top;

  if (budget === null || state.editingBudget) {
    if (isSetter()) {
      html += `
        <form class="card" id="budget-form">
          <h2>${budget === null ? `התקציב של ${monthName(month)}` : "עדכון התקציב"}</h2>
          <p class="small muted">כמה נשאר להוצאות החודש, אחרי החשבונות הקבועים.</p>
          <input class="amount-input" id="budget" type="number" inputmode="decimal" min="1" step="any"
            placeholder="₪" value="${budget ?? ""}" required>
          <div class="row">
            <button class="btn" type="submit">שמירה</button>
            ${budget !== null ? `<button class="btn secondary" type="button" id="cancel-budget">ביטול</button>` : ""}
          </div>
        </form>`;
    } else {
      html += `<div class="notice">${esc(state.family.budgetSetter)} עוד לא הגדיר/ה תקציב ל${monthName(month)}. אפשר כבר לרשום הוצאות, והיתרה תופיע ברגע שהתקציב יוגדר.</div>`;
    }
  }

  if (budget !== null) {
    const left = budget - spent;
    const pct = Math.min(100, (spent / budget) * 100);
    const cls = left < 0 ? "over" : left < budget * 0.15 ? "low" : "";
    const days = isCurrent ? daysLeft(month) : 0;
    html += `
      <section class="card balance ${cls}">
        <div class="label">${left < 0 ? "חריגה מהתקציב" : "נשאר להוציא"}</div>
        <div class="amount">${money(Math.abs(left))}</div>
        <div class="bar"><span style="width:${pct}%"></span></div>
        <div class="bar-legend"><span>הוצאנו ${money(spent)}</span><span>מתוך ${money(budget)}</span></div>
        ${isCurrent && left > 0 ? `<div class="daily">בערך ${money(Math.floor(left / days))} ליום, ל-${days} הימים שנשארו</div>` : ""}
        ${isSetter() && !state.editingBudget ? `<button class="btn link small" id="edit-budget">עדכון תקציב</button>` : ""}
      </section>`;
  }

  html += `
    <form class="card" id="expense-form">
      <h2>הוספת הוצאה</h2>
      <input class="amount-input" id="amount" type="number" inputmode="decimal" min="0.01" step="any" placeholder="₪ סכום" required>
      <div class="chips" role="group" aria-label="קטגוריה">
        ${CATEGORIES.map((c) => `<button type="button" class="chip" data-cat="${esc(c)}" aria-pressed="${c === state.category}">${esc(c)}</button>`).join("")}
      </div>
      <div class="row">
        <div><label for="desc">על מה?</label><input id="desc" maxlength="60" placeholder="לא חובה"></div>
        <div><label for="date">תאריך</label><input id="date" type="date" value="${isCurrent ? today() : `${month}-01`}" required></div>
      </div>
      <button class="btn" type="submit">הוספה</button>
    </form>`;

  if (expenses.length) {
    html += `
      <section class="card">
        <h2>לאן הלך הכסף</h2>
        <div class="tabs" role="tablist">
          <button role="tab" data-tab="category" aria-selected="${state.breakdown === "category"}">לפי קטגוריה</button>
          <button role="tab" data-tab="who" aria-selected="${state.breakdown === "who"}">לפי מי</button>
        </div>
        <div class="breakdown">${breakdownHtml(expenses, spent)}</div>
      </section>
      <section class="card">
        <h2>ההוצאות של החודש (${expenses.length})</h2>
        <ul class="list">
          ${expenses.map((e) => `
            <li>
              <div class="main">
                <div class="title">${esc(e.description || e.category)}</div>
                <div class="meta">${shortDate(e.date)} · ${esc(e.category)} · ${esc(e.who)}</div>
              </div>
              <div class="sum">${money(e.amount)}</div>
              ${e.who === state.me || isSetter() ? `<button class="del" data-id="${esc(e.id)}" aria-label="מחיקה">✕</button>` : ""}
            </li>`).join("")}
        </ul>
      </section>`;
  } else {
    html += `<p class="muted" style="text-align:center">עוד אין הוצאות ב${monthName(month)}.</p>`;
  }

  html += `
    <div class="footer">
      <button class="btn link small" id="share">קישור הצטרפות לבני המשפחה</button>
    </div>`;

  app.innerHTML = html;
  bindTop();
  bindMain();
}

function breakdownHtml(expenses, spent) {
  const key = state.breakdown === "who" ? "who" : "category";
  const totals = new Map();
  for (const e of expenses) totals.set(e[key], (totals.get(e[key]) || 0) + e.amount);
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, sum]) => `
      <div class="line">
        <span>${esc(name)}</span><strong>${money(sum)}</strong>
        <div class="bar"><span style="width:${(sum / spent) * 100}%"></span></div>
      </div>`).join("");
}

function bindTop() {
  document.getElementById("prev").onclick = () => { state.month = shiftMonth(state.month, -1); startMonth(); };
  document.getElementById("next").onclick = () => { state.month = shiftMonth(state.month, 1); startMonth(); };
  document.getElementById("switch").onclick = () => {
    if (state.unsubscribe) state.unsubscribe();
    store("me", null);
    state.me = null;
    renderPickUser();
  };
}

function bindMain() {
  const budgetForm = document.getElementById("budget-form");
  if (budgetForm) {
    budgetForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const amount = Number(document.getElementById("budget").value);
      if (!(amount > 0)) return;
      state.editingBudget = false;
      try {
        await db.setBudget(state.familyId, state.month, amount, state.me);
        toast("התקציב נשמר");
      } catch (err) { console.error(err); toast("השמירה נכשלה"); }
    });
    const cancel = document.getElementById("cancel-budget");
    if (cancel) cancel.onclick = () => { state.editingBudget = false; renderMain(); };
  }
  const edit = document.getElementById("edit-budget");
  if (edit) edit.onclick = () => { state.editingBudget = true; renderMain(); };

  app.querySelectorAll(".chip").forEach((chip) => chip.addEventListener("click", () => {
    state.category = chip.dataset.cat;
    app.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", c === chip));
  }));

  document.getElementById("expense-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const amount = Math.round(Number(document.getElementById("amount").value) * 100) / 100;
    const date = document.getElementById("date").value;
    if (!(amount > 0) || !date) return;
    const btn = e.submitter;
    btn.disabled = true;
    try {
      await db.addExpense(state.familyId, {
        amount, date,
        category: state.category,
        description: document.getElementById("desc").value.trim(),
        who: state.me
      });
      toast(`נוספה הוצאה של ${money(amount)}`);
      if (date.slice(0, 7) !== state.month) { state.month = date.slice(0, 7); startMonth(); }
    } catch (err) {
      console.error(err);
      toast("ההוספה נכשלה");
      btn.disabled = false;
    }
  });

  app.querySelectorAll("[data-tab]").forEach((t) => t.addEventListener("click", () => {
    state.breakdown = t.dataset.tab;
    renderMain();
  }));

  app.querySelectorAll(".del").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("למחוק את ההוצאה?")) return;
    try { await db.deleteExpense(state.familyId, b.dataset.id); toast("נמחק"); }
    catch (err) { console.error(err); toast("המחיקה נכשלה"); }
  }));

  document.getElementById("share").onclick = async () => {
    const link = joinLink();
    if (navigator.share) {
      try { await navigator.share({ title: "התקציב המשפחתי", text: "הצטרפות לתקציב המשפחתי שלנו", url: link }); return; }
      catch { /* המשתמש ביטל, נעבור להעתקה */ }
    }
    try { await navigator.clipboard.writeText(link); toast("הקישור הועתק"); }
    catch { prompt("העתיקו את הקישור:", link); }
  };
}

// ---------- הפעלה ----------

async function init() {
  const fromLink = new URLSearchParams(location.hash.slice(1)).get("f");
  if (fromLink) {
    store("familyId", fromLink);
    history.replaceState(null, "", location.pathname);
  }
  state.familyId = store("familyId");
  state.me = store("me");

  try {
    await db.signIn();
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="notice">אין חיבור לשרת. בדקו את האינטרנט ונסו לרענן.</div>`;
    return;
  }

  if (!state.familyId) { renderSetup(); return; }

  state.family = await db.getFamily(state.familyId).catch(() => null);
  if (!state.family) {
    store("familyId", null);
    app.innerHTML = `<div class="notice">קישור ההצטרפות לא תקין. בקשו קישור חדש מבן משפחה.</div>`;
    return;
  }
  if (!state.me || !state.family.members.includes(state.me)) { renderPickUser(); return; }
  startMonth();
}

init();
