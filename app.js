/* ==========================================================================
   LiquidAssets - shared page logic
   Reads live state from the Cloudflare Pages Functions (/api/funds,
   /api/research, /api/quotes) and falls back to built-in defaults when the
   API isn't there (opened locally, offline, or before the first AI run).
   Every renderer no-ops on pages that don't contain its elements.
   ========================================================================== */

const el = id => document.getElementById(id);
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ---------------- Defaults (entry === current, so returns start at 0.00%) --- */
const defaultFunds = [
  {
    id: "WTR-AG", code: "WTR-AG", name: "Whitewater", risk: "Aggressive",
    description: "Aggressive growth. Backs bold, fast-moving companies for outsized upside.",
    holdings: [
      { ticker: "RKLB", company: "Rocket Lab", weight: 16, entryPrice: 81.17, currentPrice: 81.17 },
      { ticker: "ASTS", company: "AST SpaceMobile", weight: 15, entryPrice: 46.80, currentPrice: 46.80 },
      { ticker: "NVDA", company: "NVIDIA", weight: 14, entryPrice: 224.09, currentPrice: 224.09 },
      { ticker: "PLTR", company: "Palantir Technologies", weight: 13, entryPrice: 171.04, currentPrice: 171.04 },
      { ticker: "TSLA", company: "Tesla", weight: 12, entryPrice: 327.51, currentPrice: 327.51 },
      { ticker: "IONQ", company: "IonQ", weight: 11, entryPrice: 41.05, currentPrice: 41.05 },
      { ticker: "AMD", company: "AMD", weight: 10, entryPrice: 174.90, currentPrice: 174.90 },
      { ticker: "CRWD", company: "CrowdStrike Holdings", weight: 9, entryPrice: 419.60, currentPrice: 419.60 }
    ]
  },
  {
    id: "WTR-MD", code: "WTR-MD", name: "Tidewater", risk: "Balanced",
    description: "Balanced approach. Steady compounding with controlled drawdown.",
    holdings: [
      { ticker: "VOO", company: "Vanguard S&P 500 ETF", weight: 18, entryPrice: 710.17, currentPrice: 710.17 },
      { ticker: "QQQ", company: "Invesco QQQ", weight: 15, entryPrice: 578.40, currentPrice: 578.40 },
      { ticker: "MSFT", company: "Microsoft", weight: 13, entryPrice: 492.43, currentPrice: 492.43 },
      { ticker: "GOOGL", company: "Alphabet", weight: 12, entryPrice: 343.54, currentPrice: 343.54 },
      { ticker: "LLY", company: "Eli Lilly", weight: 11, entryPrice: 905.00, currentPrice: 905.00 },
      { ticker: "UNH", company: "UnitedHealth", weight: 11, entryPrice: 405.59, currentPrice: 405.59 },
      { ticker: "V", company: "Visa", weight: 10, entryPrice: 359.42, currentPrice: 359.42 },
      { ticker: "COST", company: "Costco", weight: 10, entryPrice: 949.58, currentPrice: 949.58 }
    ]
  },
  {
    id: "WTR-LO", code: "WTR-LO", name: "Stillwater", risk: "Defensive",
    description: "Capital preservation. Low drawdown, boring on purpose.",
    holdings: [
      { ticker: "VOO", company: "Vanguard S&P 500 ETF", weight: 24, entryPrice: 710.17, currentPrice: 710.17 },
      { ticker: "SCHD", company: "Schwab US Dividend ETF", weight: 16, entryPrice: 28.15, currentPrice: 28.15 },
      { ticker: "BND", company: "Vanguard Total Bond ETF", weight: 14, entryPrice: 72.28, currentPrice: 72.28 },
      { ticker: "GLD", company: "SPDR Gold", weight: 12, entryPrice: 309.40, currentPrice: 309.40 },
      { ticker: "JNJ", company: "Johnson & Johnson", weight: 10, entryPrice: 170.20, currentPrice: 170.20 },
      { ticker: "KO", company: "Coca-Cola", weight: 9, entryPrice: 86.71, currentPrice: 86.71 },
      { ticker: "PG", company: "Procter & Gamble", weight: 8, entryPrice: 144.08, currentPrice: 144.08 },
      { ticker: "BRK.B", company: "Berkshire Hathaway", weight: 7, entryPrice: 510.00, currentPrice: 510.00 }
    ]
  }
];

let funds = defaultFunds.map(f => ({ ...f, holdings: f.holdings.map(h => ({ ...h })) }));
let activeFundId = funds[0].id;

/* ---------------- Helpers ---------------- */
function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" }[c]));
}
function money(value, digits = 2) {
  return new Intl.NumberFormat("en-NZ", {
    style: "currency", currency: "USD",
    minimumFractionDigits: digits, maximumFractionDigits: digits
  }).format(Number.isFinite(value) ? value : 0);
}
function signed(value, digits = 1) {
  const v = Number.isFinite(value) ? value : 0;
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}
function riskClass(risk) {
  if (risk === "Aggressive") return "risk-high";
  if (risk === "Defensive") return "risk-low";
  return "risk-med";
}
function riskLabel(risk) {
  if (risk === "Aggressive") return "High risk";
  if (risk === "Defensive") return "Low risk";
  return "Medium risk";
}
function fundReturn(fund) {
  const cost = fund.holdings.reduce((s, h) => s + (Number(h.weight) || 0) * (Number(h.entryPrice) || 0), 0);
  const value = fund.holdings.reduce((s, h) => s + (Number(h.weight) || 0) * (Number(h.currentPrice) || 0), 0);
  return cost ? ((value - cost) / cost) * 100 : 0;
}
function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" });
}

/* ---------------- Home ---------------- */
function renderHome() {
  const grid = el("homeFunds");
  if (!grid) return;

  grid.innerHTML = funds.map(f => {
    const ret = fundReturn(f);
    return `
      <a class="fund-card" href="fund.html" data-fund="${escapeHtml(f.id)}">
        <span class="risk-label ${riskClass(f.risk)}">${escapeHtml(riskLabel(f.risk))}</span>
        <h3>${escapeHtml(f.name)}</h3>
        <p>${escapeHtml((f.description || "").split(".")[0] + ".")}</p>
        <div class="fund-card-foot">
          <span class="ret ${ret >= 0 ? "positive" : "negative"}">${signed(ret)}</span>
          <span class="lbl">YTD return</span>
          <span class="sep">|</span>
          <span class="lbl">${f.holdings.length} positions</span>
        </div>
      </a>`;
  }).join("");

  if (el("stripFunds")) el("stripFunds").textContent = `${funds.length} funds`;
}

/* ---------------- Funds page ---------------- */
function renderFundsPage() {
  const picker = el("fundPicker");
  if (!picker) return;

  picker.innerHTML = funds.map(f => {
    const ret = fundReturn(f);
    return `
      <button class="pick" role="tab" aria-selected="${f.id === activeFundId}" data-fund="${escapeHtml(f.id)}">
        <span class="risk-label ${riskClass(f.risk)}">${escapeHtml(riskLabel(f.risk))}</span>
        <span class="pick-arrow" aria-hidden="true">›</span>
        <h3>${escapeHtml(f.name)}</h3>
        <p>${escapeHtml((f.description || "").split(".")[0] + ".")}</p>
        <span class="pick-foot">
          <span class="ret ${ret >= 0 ? "positive" : "negative"}">${signed(ret)}</span>
          <span class="lbl">YTD return</span>
        </span>
      </button>`;
  }).join("");

  $$(".pick", picker).forEach(btn => btn.addEventListener("click", () => {
    activeFundId = btn.dataset.fund;
    $$(".pick", picker).forEach(b => b.setAttribute("aria-selected", b === btn));
    renderFundDetail();
  }));

  renderFundDetail();
}

function renderFundDetail() {
  const fund = funds.find(f => f.id === activeFundId) || funds[0];
  if (!fund || !el("detailName")) return;

  const ret = fundReturn(fund);
  el("detailName").textContent = fund.name;
  el("detailDesc").textContent = fund.description || "";
  const retNode = el("detailReturn");
  retNode.textContent = signed(ret);
  retNode.className = ret >= 0 ? "positive" : "negative";
  el("detailPositions").textContent = String(fund.holdings.length);

  const body = el("topHoldings");
  if (body) {
    body.innerHTML = fund.holdings.slice(0, 4).map(h => `
      <tr>
        <td>${escapeHtml(h.company || h.ticker)}</td>
        <td>${Number(h.weight || 0).toFixed(1)}%</td>
      </tr>`).join("");
  }

  drawChart(ret);
}

// Deterministic wiggle around the fund's real return, so the shape is stable per fund.
function drawChart(finalReturn) {
  const svg = el("fundChart");
  if (!svg) return;
  svg.removeAttribute("preserveAspectRatio");

  const W = 560, H = 232, padL = 46, padR = 12, padT = 14, padB = 30;
  const points = 34;
  const span = Math.max(6, Math.abs(finalReturn) * 1.8);
  const seedBase = (activeFundId || "x").split("").reduce((a, c) => a + c.charCodeAt(0), 0);

  const series = [];
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    const drift = finalReturn * t;
    const wobble = Math.sin(t * 8 + seedBase) * span * 0.13 + Math.sin(t * 19 + seedBase * 0.7) * span * 0.06;
    series.push(i === points - 1 ? finalReturn : drift + wobble);
  }

  const x = i => padL + (i / (points - 1)) * (W - padL - padR);
  const y = v => padT + (1 - (v + span) / (span * 2)) * (H - padT - padB);

  const line = series.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L ${x(points - 1).toFixed(1)} ${y(-span)} L ${padL} ${y(-span)} Z`;

  const ticks = [span, span / 2, 0, -span / 2, -span];
  const grid = ticks.map(v => `
    <line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W - padR}" y2="${y(v).toFixed(1)}"
          stroke="rgba(255,255,255,.07)" stroke-width="1" stroke-dasharray="3 5"/>
    <text x="${padL - 10}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end"
          fill="#6a7280" font-size="10" font-family="IBM Plex Mono, monospace">${v >= 0 ? "+" : ""}${v.toFixed(0)}%</text>
  `).join("");

  const months = ["Jan", "Feb", "Mar", "Apr", "May"];
  const labels = months.map((m, i) => {
    const px = padL + (i / (months.length - 1)) * (W - padL - padR);
    return `<text x="${px.toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="#6a7280" font-size="10"
             font-family="IBM Plex Mono, monospace">${m} '26</text>`;
  }).join("");

  svg.innerHTML = `
    <defs>
      <linearGradient id="fillGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#2563eb" stop-opacity=".35"/>
        <stop offset="100%" stop-color="#2563eb" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${grid}
    <path d="${area}" fill="url(#fillGrad)"/>
    <path d="${line}" fill="none" stroke="#4d8bff" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
    ${labels}
  `;
}

/* ---------------- Commentary ---------------- */
const CATS = [
  { key: "markets", label: "Markets", cls: "tag-markets" },
  { key: "macro", label: "Macro", cls: "tag-macro" },
  { key: "portfolio", label: "Portfolio", cls: "tag-portfolio" },
  { key: "sentiment", label: "Sentiment", cls: "tag-sentiment" }
];

async function hydrateCommentary() {
  const list = el("brief");
  if (!list) return;
  try {
    const res = await fetch("/api/research", { headers: { accept: "application/json" } });
    if (!res.ok) return;
    const data = await res.json();
    const briefs = data?.briefs || [];
    if (!briefs.length) return;

    // Featured = newest brief.
    const b = briefs[0];
    if (el("featTitle")) {
      if (b.lede) el("featTitle").textContent = b.lede;
      if (el("featDate")) el("featDate").textContent = formatDate(b.date);
      if (el("featBody")) el("featBody").textContent = b.market || b.why || b.moves || "";
    }

    // The rest become rows.
    const rows = briefs.slice(1);
    if (rows.length) {
      list.innerHTML = rows.map((brief, i) => {
        const cat = CATS[i % CATS.length];
        return `
          <a class="note-row" href="commentary.html" data-cat="${cat.key}">
            <span class="tag-pill ${cat.cls}">${cat.label}</span>
            <span class="date">${escapeHtml(formatDate(brief.date))}</span>
            <h3>${escapeHtml(brief.lede || brief.market || "Daily note")}</h3>
            <span class="read">Read <span aria-hidden="true">→</span></span>
          </a>`;
      }).join("");
    }
    initFilters();
  } catch (error) {
    // Keep the placeholder notes.
  }
}

async function renderHomeNote() {
  if (!el("homeNoteTitle")) return;
  try {
    const res = await fetch("/api/research", { headers: { accept: "application/json" } });
    if (!res.ok) return;
    const data = await res.json();
    const b = data?.briefs?.[0];
    if (!b) return;
    if (b.lede) el("homeNoteTitle").textContent = b.lede;
    if (el("homeNoteDate")) el("homeNoteDate").textContent = formatDate(b.date);
    if (el("homeNoteSub") && (b.market || b.moves)) el("homeNoteSub").textContent = b.market || b.moves;
  } catch (error) {
    // Keep the placeholder.
  }
}

/* ---------------- Filters + search ---------------- */
function initFilters() {
  $$(".chips").forEach(group => {
    if (group.dataset.bound === "1") return; // may run again after live data loads
    group.dataset.bound = "1";
    const chips = $$(".chip", group);
    chips.forEach(chip => chip.addEventListener("click", () => {
      chips.forEach(c => c.setAttribute("aria-selected", c === chip));
      applyFilter(chip.dataset.filter);
    }));
  });
}

function applyFilter(filter) {
  const rows = [...$$(".note-row"), ...$$(".res-row")];
  rows.forEach(row => {
    const show = !filter || filter === "all" || row.dataset.cat === filter;
    row.style.display = show ? "" : "none";
  });
}

function initSearch() {
  const input = el("researchSearch");
  if (!input) return;
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    $$(".res-row").forEach(row => {
      row.style.display = !q || row.textContent.toLowerCase().includes(q) ? "" : "none";
    });
  });
}

/* ---------------- Live quotes ---------------- */
async function refreshQuotes() {
  // Only pages that actually show prices need the quote feed.
  if (!el("homeFunds") && !el("fundPicker")) return;
  const symbols = [...new Set(funds.flatMap(f => f.holdings.map(h => h.ticker)))];
  if (!symbols.length) return;
  try {
    const res = await fetch(`/api/quotes?symbols=${encodeURIComponent(symbols.join(","))}`, {
      headers: { accept: "application/json" }
    });
    if (!res.ok) return;
    const data = await res.json();
    const quotes = data?.quotes;
    if (!quotes || !Object.keys(quotes).length) return;
    funds.forEach(f => f.holdings.forEach(h => {
      const q = quotes[h.ticker];
      if (q && Number.isFinite(q.price) && q.price > 0) h.currentPrice = q.price;
    }));
    renderHome();
    renderFundDetail();
  } catch (error) {
    // Stored prices stay in place.
  }
}

/* ---------------- Live funds from D1 ---------------- */
async function hydrateFunds() {
  try {
    const res = await fetch("/api/funds", { headers: { accept: "application/json" } });
    if (!res.ok) return;
    const data = await res.json();
    if (!data?.funds?.length) return;
    const live = data.funds.filter(f => (f.holdings || []).length);
    if (!live.length) return;
    funds = live.map(f => ({
      id: f.code, code: f.code, name: f.name, risk: f.risk, description: f.description,
      holdings: (f.holdings || []).map(h => ({
        ticker: h.ticker, company: h.company, weight: h.weight,
        entryPrice: h.entryPrice, currentPrice: h.currentPrice
      }))
    }));
    if (!funds.some(f => f.id === activeFundId)) activeFundId = funds[0].id;
    renderHome();
    renderFundsPage();
  } catch (error) {
    // Defaults stay.
  }
}

/* ---------------- Nav, subscribe, reveals ---------------- */
function initNav() {
  const burger = el("hamburger");
  if (!burger) return;
  const close = () => document.body.classList.remove("nav-open");
  burger.addEventListener("click", () => document.body.classList.toggle("nav-open"));
  $$(".mobile-nav a").forEach(a => a.addEventListener("click", close));
  document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
}

function toast(message) {
  const node = el("toast");
  if (!node) return;
  node.textContent = message;
  node.classList.add("visible");
  setTimeout(() => node.classList.remove("visible"), 3200);
}

function initSubscribe() {
  const form = el("subForm");
  if (!form) return;
  form.addEventListener("submit", event => {
    event.preventDefault();
    const email = el("subEmail");
    if (!email || !email.value.trim()) return;
    toast("Thanks. You're on the list.");
    form.reset();
  });
}

function observeReveals() {
  const targets = $$(".reveal:not(.visible)");
  if (!targets.length) return;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !("IntersectionObserver" in window)) {
    targets.forEach(t => t.classList.add("visible"));
    return;
  }
  const io = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("visible");
      obs.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -8% 0px", threshold: .08 });
  targets.forEach(t => io.observe(t));
}

/* ---------------- Boot ---------------- */
initNav();
initSubscribe();
initFilters();
initSearch();
renderHome();
renderFundsPage();
observeReveals();

hydrateFunds();
hydrateCommentary();
renderHomeNote();
refreshQuotes();
setInterval(refreshQuotes, 60000);
