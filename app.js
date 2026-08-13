/* ============================================================
   LiquidAssets shared app logic (page-aware)
   Every render helper no-ops if its page elements are absent,
   so the same file safely powers Home, AI Fund and Research.
   ============================================================ */

const STORAGE_KEY = "watercooler-funds-v3";
const PREFS_KEY = "watercooler-prefs-v3";

function uid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `wc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ---------------- Default data ---------------- */
const defaultFunds = [
  {
    id: "whitewater",
    name: "Whitewater",
    code: "WTR-AG",
    risk: "Aggressive",
    description: "High-risk, high-velocity alpha generation from market chaos.",
    holdings: [
      { id: uid(), ticker: "RKLB", company: "Rocket Lab", weight: 28, shares: 90, entryPrice: 24.2, currentPrice: 24.2, thesis: "Launch, space systems and long-duration infrastructure growth." },
      { id: uid(), ticker: "NVDA", company: "NVIDIA", weight: 25, shares: 12, entryPrice: 132.5, currentPrice: 132.5, thesis: "Core compute layer for accelerated AI workloads." },
      { id: uid(), ticker: "PLTR", company: "Palantir", weight: 20, shares: 35, entryPrice: 92.8, currentPrice: 92.8, thesis: "Operational AI deployment with strong government and enterprise positioning." },
      { id: uid(), ticker: "TSLA", company: "Tesla", weight: 14, shares: 7, entryPrice: 301.4, currentPrice: 301.4, thesis: "High-variance autonomy, energy and manufacturing optionality." }
    ]
  },
  {
    id: "deepwater",
    name: "Deepwater",
    code: "WTR-MD",
    risk: "Balanced",
    description: "Medium-risk, current-driven institutional growth.",
    holdings: [
      { id: uid(), ticker: "MSFT", company: "Microsoft", weight: 24, shares: 8, entryPrice: 446.2, currentPrice: 446.2, thesis: "Cloud distribution, enterprise software and AI monetisation." },
      { id: uid(), ticker: "GOOGL", company: "Alphabet", weight: 20, shares: 14, entryPrice: 184.7, currentPrice: 184.7, thesis: "Search cash flows funding a broad AI and infrastructure portfolio." },
      { id: uid(), ticker: "AMZN", company: "Amazon", weight: 20, shares: 11, entryPrice: 207.4, currentPrice: 207.4, thesis: "AWS, logistics scale and operating leverage." },
      { id: uid(), ticker: "V", company: "Visa", weight: 15, shares: 9, entryPrice: 330.5, currentPrice: 330.5, thesis: "Global payment rails with resilient economics." }
    ]
  },
  {
    id: "stillwater",
    name: "Stillwater",
    code: "WTR-LO",
    risk: "Defensive",
    description: "Low-risk, high-certainty capital preservation.",
    holdings: [
      { id: uid(), ticker: "VOO", company: "Vanguard S&P 500 ETF", weight: 38, shares: 10, entryPrice: 552.1, currentPrice: 552.1, thesis: "Low-cost US large-cap core exposure." },
      { id: uid(), ticker: "BRK.B", company: "Berkshire Hathaway", weight: 20, shares: 8, entryPrice: 472.2, currentPrice: 472.2, thesis: "Diversified quality assets and disciplined capital allocation." },
      { id: uid(), ticker: "COST", company: "Costco", weight: 15, shares: 3, entryPrice: 940.3, currentPrice: 940.3, thesis: "Recurring membership economics and resilient consumer loyalty." },
      { id: uid(), ticker: "BND", company: "Vanguard Total Bond Market ETF", weight: 15, shares: 20, entryPrice: 73.1, currentPrice: 73.1, thesis: "Broad fixed-income ballast." }
    ]
  }
];

const defaultPrefs = {
  risk: "Balanced",
  horizon: "3 to 5 years",
  depth: "Concise",
  maxPosition: "25",
  industries: "Space, AI, Infrastructure, Defence",
  watch: "Rocket Lab, space systems, AI platforms, economic shifts, sentiment spikes"
};

/* ---------------- State ---------------- */
function cloneDefaults() {
  return JSON.parse(JSON.stringify(defaultFunds));
}

function loadState() {
  // Read-only dashboard: funds always come from code (the AI's book, for now),
  // so wording/holdings edits show immediately. We only remember which fund the
  // viewer last looked at.
  let savedActiveFundId = "whitewater";
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (stored?.activeFundId) savedActiveFundId = stored.activeFundId;
  } catch (error) {
    console.warn("Could not read saved Watercooler data", error);
  }
  return { funds: cloneDefaults(), activeFundId: savedActiveFundId };
}

function saveState() {
  state.activeFundId = activeFundId;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ activeFundId }));
}

function loadPrefs() {
  try {
    return { ...defaultPrefs, ...(JSON.parse(localStorage.getItem(PREFS_KEY)) || {}) };
  } catch (error) {
    return { ...defaultPrefs };
  }
}

let state = loadState();
let activeFundId = state.activeFundId || state.funds[0]?.id;

/* ---------------- Formatting helpers ---------------- */
function money(value, digits = 0) {
  return new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(Number.isFinite(value) ? value : 0);
}

function number(value, digits = 0) {
  return new Intl.NumberFormat("en-NZ", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(Number.isFinite(value) ? value : 0);
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" })[char]);
}

function riskLabel(risk) {
  if (risk === "Aggressive") return "High risk";
  if (risk === "Defensive") return "Low risk";
  return "Medium risk";
}

// 3 = high, 2 = medium, 1 = low, drives the card strip, badge and meter.
function riskLevel(risk) {
  if (risk === "Aggressive") return 3;
  if (risk === "Defensive") return 1;
  return 2;
}

function riskClass(risk) {
  if (risk === "Aggressive") return "risk-high";
  if (risk === "Defensive") return "risk-low";
  return "risk-med";
}

function signed(value, digits = 1, suffix = "%") {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}${suffix}`;
}

/* ---------------- Stats ---------------- */
function fundStats(fund) {
  const cost = fund.holdings.reduce((sum, item) => sum + item.shares * item.entryPrice, 0);
  const value = fund.holdings.reduce((sum, item) => sum + item.shares * item.currentPrice, 0);
  const pnl = value - cost;
  const returnPct = cost ? (pnl / cost) * 100 : 0;
  const weight = fund.holdings.reduce((sum, item) => sum + Number(item.weight || 0), 0);
  return { cost, value, pnl, returnPct, weight };
}

function allStats() {
  return state.funds.reduce((acc, fund) => {
    const stats = fundStats(fund);
    acc.value += stats.value;
    acc.cost += stats.cost;
    acc.positions += fund.holdings.length;
    return acc;
  }, { value: 0, cost: 0, positions: 0 });
}

function activeFund() {
  return state.funds.find(fund => fund.id === activeFundId) || state.funds[0];
}

/* ---------------- Element handles (may be null per page) ---------------- */
const el = id => document.getElementById(id);
const fundGrid = el("fundGrid");        // home summary + fund page rail share this id
const fundSelect = el("fundSelect");
const fundSummary = el("fundSummary");
const holdingsBody = el("holdingsBody");
const holdingsTable = el("holdingsTable");
const emptyState = el("emptyState");
const winnersLosers = el("winnersLosers");
const chartSvg = el("chartSvg");
const marketTape = el("marketTape");
const toast = el("toast");

/* ---------------- Renderers ---------------- */
function renderFundCards() {
  if (!fundGrid) return;
  const selectable = fundGrid.dataset.selectable === "true";
  fundGrid.innerHTML = state.funds.map((fund, index) => {
    const stats = fundStats(fund);
    const active = selectable && fund.id === activeFundId ? "active" : "";
    return `
      <article class="fund-card reveal ${active}" data-risk="${escapeHtml(fund.risk)}" data-level="${riskLevel(fund.risk)}" data-fund-id="${fund.id}" data-delay="${index % 3}">
        <span class="risk-strip" aria-hidden="true"></span>
        <div class="fund-card-head">
          <span class="risk-badge ${riskClass(fund.risk)}">${riskLabel(fund.risk)}</span>
          <span class="fund-code">${escapeHtml(fund.code)}</span>
        </div>
        <div class="risk-meter" aria-hidden="true"><i></i><i></i><i></i></div>
        <h3>${escapeHtml(fund.name)}</h3>
        <p>${escapeHtml(fund.description || "A custom model portfolio.")}</p>
        <div class="fund-card-footer">
          <div><span>Positions</span><strong>${fund.holdings.length}</strong></div>
          <div><span>Return</span><strong class="${stats.returnPct >= 0 ? "positive" : "negative"}">${signed(stats.returnPct)}</strong></div>
          <div><span>Allocated</span><strong>${number(stats.weight, 1)}%</strong></div>
        </div>
      </article>
    `;
  }).join("");

  fundGrid.querySelectorAll(".fund-card").forEach(card => {
    card.addEventListener("click", () => {
      activeFundId = card.dataset.fundId;
      saveState();
      if (selectable) {
        render();
        el("fundDesk")?.scrollIntoView({ behavior: "smooth" });
      } else {
        // Home: jump to the AI Fund page with this fund active
        window.location.href = "fund.html";
      }
    });
  });
  observeReveals();
}

function renderFundSelect() {
  if (!fundSelect) return;
  fundSelect.innerHTML = state.funds
    .map(fund => `<option value="${fund.id}" ${fund.id === activeFundId ? "selected" : ""}>${escapeHtml(fund.name)} / ${escapeHtml(fund.code)}</option>`)
    .join("");
}

let metricsAnimated = false;
const reduceMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function setMetric(node, target, format) {
  if (!node) return;
  if (metricsAnimated || reduceMotion()) { node.textContent = format(target); return; }
  const start = performance.now();
  const duration = 900;
  (function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    node.textContent = format(target * eased);
    if (t < 1) requestAnimationFrame(frame);
    else node.textContent = format(target);
  })(start);
}

function renderTopMetrics() {
  const totals = allStats();
  const pnl = totals.value - totals.cost;
  setMetric(el("metricFunds"), state.funds.length, v => String(Math.round(v)));
  setMetric(el("metricPositions"), totals.positions, v => String(Math.round(v)));
  setMetric(el("metricValue"), totals.value, v => money(v));
  if (el("metricPnl")) {
    el("metricPnl").className = pnl >= 0 ? "positive" : "negative";
    setMetric(el("metricPnl"), pnl, v => `${pnl >= 0 ? "+" : ""}${money(v)}`);
  }
  if (el("heroFundCount")) el("heroFundCount").textContent = String(state.funds.length).padStart(2, "0");
  metricsAnimated = true;
}

function renderSummary() {
  if (!fundSummary) return;
  const fund = activeFund();
  if (!fund) return;
  const stats = fundStats(fund);
  const benchmark = stats.returnPct - 4.2;
  const daily = stats.returnPct / 12;

  fundSummary.innerHTML = `
    <div class="summary-main">
      <span class="micro-label">${escapeHtml(fund.code)} · ${escapeHtml(fund.risk)}</span>
      <h3>${escapeHtml(fund.name)}</h3>
      <p>${escapeHtml(fund.description || "No mandate added yet.")}</p>
    </div>
    <div class="summary-stat"><span class="micro-label">Model value</span><strong>${money(stats.value)}</strong></div>
    <div class="summary-stat"><span class="micro-label">Open P/L</span><strong class="${stats.pnl >= 0 ? "positive" : "negative"}">${stats.pnl >= 0 ? "+" : ""}${money(stats.pnl)}</strong></div>
    <div class="summary-stat"><span class="micro-label">Return</span><strong class="${stats.returnPct >= 0 ? "positive" : "negative"}">${signed(stats.returnPct)}</strong></div>
  `;

  // Performance panel figures
  if (el("perfFundCode")) el("perfFundCode").textContent = fund.code;
  setSignedText("scoreReturn", stats.returnPct);
  setSignedText("scoreBenchmark", benchmark);
  setSignedText("scoreDaily", daily, 2);
  setSignedText("chartReturn", stats.returnPct);
  if (el("chartSubline")) el("chartSubline").textContent = `${fund.name} vs S&P 500 · illustrative`;
}

function setSignedText(id, value, digits = 1) {
  const node = el(id);
  if (!node) return;
  node.textContent = signed(value, digits);
  node.className = value >= 0 ? "positive" : "negative";
}

function renderHoldings() {
  if (!holdingsBody) return;
  const fund = activeFund();
  const holdings = fund?.holdings || [];
  holdingsBody.innerHTML = holdings.map(item => {
    const value = item.shares * item.currentPrice;
    const cost = item.shares * item.entryPrice;
    const returnPct = cost ? ((value - cost) / cost) * 100 : 0;
    return `
      <tr>
        <td>
          <div class="asset-cell">
            <span class="asset-badge">${escapeHtml(item.ticker.slice(0, 5))}</span>
            <span class="asset-meta">
              <strong>${escapeHtml(item.ticker)}</strong>
              <span title="${escapeHtml(item.thesis || item.company || "")}">${escapeHtml(item.company || item.thesis || "")}</span>
            </span>
          </div>
        </td>
        <td>${number(item.weight, 1)}%</td>
        <td>${number(item.shares, 4)}</td>
        <td>${money(item.entryPrice, 2)}</td>
        <td>${money(item.currentPrice, 2)}</td>
        <td><strong>${money(value)}</strong></td>
        <td class="${returnPct >= 0 ? "positive" : "negative"}"><strong>${signed(returnPct)}</strong></td>
      </tr>
    `;
  }).join("");

  if (emptyState) emptyState.classList.toggle("visible", holdings.length === 0);
  if (holdingsTable) holdingsTable.style.display = holdings.length ? "table" : "none";
}

function renderWinnersLosers() {
  if (!winnersLosers) return;
  const fund = activeFund();
  const holdings = (fund?.holdings || []).map(item => {
    const value = item.shares * item.currentPrice;
    const cost = item.shares * item.entryPrice;
    const returnPct = cost ? ((value - cost) / cost) * 100 : 0;
    return { ...item, returnPct };
  }).sort((a, b) => b.returnPct - a.returnPct);

  const winners = holdings.slice(0, 3);
  const losers = [...holdings].reverse().slice(0, 3);
  if (el("wlCount")) el("wlCount").textContent = `${holdings.length} positions`;

  const column = (title, items, type) => `
    <div class="score-card">
      <span class="micro-label">${title}</span>
      ${items.length ? items.map(item => `
        <div class="wl-row">
          <div>
            <strong class="tkr">${escapeHtml(item.ticker)}</strong>
            <p>${escapeHtml(item.company || item.thesis || "")}</p>
          </div>
          <strong class="${type === "winner" ? "positive" : "negative"}">${signed(item.returnPct)}</strong>
        </div>
      `).join("") : `<p style="margin-top:12px;color:var(--muted);">No positions yet.</p>`}
    </div>
  `;

  winnersLosers.innerHTML = column("Winners", winners, "winner") + column("Losers", losers, "loser");
}

let liveQuotes = {};

function renderTape() {
  if (!marketTape) return;
  // One entry per unique ticker across all funds.
  const seen = new Map();
  state.funds.forEach(fund => fund.holdings.forEach(item => {
    if (!seen.has(item.ticker)) seen.set(item.ticker, item);
  }));
  let items = [...seen.values()];
  if (!items.length) items = [{ ticker: "WTR", entryPrice: 1, currentPrice: 1 }];

  const markup = items.map(item => {
    const live = liveQuotes[item.ticker];
    const price = live ? live.price : item.currentPrice;
    const movePct = live && Number.isFinite(live.changePct)
      ? live.changePct
      : (item.entryPrice ? ((item.currentPrice - item.entryPrice) / item.entryPrice) * 100 : 0);
    return `<span class="tape-item"><span>${escapeHtml(item.ticker)}</span><span>${money(price, 2)}</span><b class="${movePct < 0 ? "negative" : ""}">${movePct < 0 ? "▼" : "▲"} ${signed(movePct, 2)}</b></span>`;
  }).join("");
  marketTape.innerHTML = `<div class="tape-group">${markup}</div><div class="tape-group" aria-hidden="true">${markup}</div>`;
}

// Pulls live quotes from the /api/quotes Pages Function. If it is not there
// (opened as a local file, offline, or no API key set), the ticker quietly
// keeps using the manually entered prices.
async function refreshQuotes() {
  if (!marketTape) return;
  const symbols = [...new Set(state.funds.flatMap(fund => fund.holdings.map(h => h.ticker)))];
  if (!symbols.length) return;
  try {
    const res = await fetch(`/api/quotes?symbols=${encodeURIComponent(symbols.join(","))}`, {
      headers: { accept: "application/json" }
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !data.quotes || !Object.keys(data.quotes).length) return;
    liveQuotes = data.quotes;
    renderTape();
  } catch (error) {
    // No live feed available; the fallback ticker stays as-is.
  }
}

/* ---------------- Performance chart ---------------- */
function renderChart() {
  if (!chartSvg) return;
  const fund = activeFund();
  if (!fund) return;
  const stats = fundStats(fund);
  const benchmarkFinal = Math.max(-12, stats.returnPct - 4.2);
  const fundSeries = buildSeries(stats.returnPct, 12, 3.1);
  const benchSeries = buildSeries(benchmarkFinal, 12, 1.8);
  chartSvg.innerHTML = `
    <defs>
      <linearGradient id="fundFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#0969ff" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="#0969ff" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${renderGrid()}
    <path d="${areaPath(fundSeries, 680, 240)}" fill="url(#fundFill)"></path>
    <path d="${linePath(benchSeries, 680, 240)}" fill="none" stroke="rgba(87,101,125,.55)" stroke-width="2.5" stroke-dasharray="8 8"></path>
    <path d="${linePath(fundSeries, 680, 240)}" fill="none" stroke="var(--accent)" stroke-width="3.5"></path>
  `;
}

function buildSeries(finalValue, count = 12, wobble = 2) {
  const series = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const curve = finalValue * t;
    const noise = Math.sin(i * 0.9) * wobble * (1 - t * 0.2) + Math.cos(i * 0.42) * wobble * 0.35;
    series.push(curve + noise);
  }
  return series;
}

function linePath(series, width, height) {
  const min = Math.min(...series, -10);
  const max = Math.max(...series, 10);
  const pad = 14;
  const scaleY = value => {
    const n = (value - min) / (max - min || 1);
    return height - pad - n * (height - pad * 2);
  };
  const scaleX = index => (index / (series.length - 1)) * width;
  return series.map((value, index) => `${index === 0 ? "M" : "L"}${scaleX(index)} ${scaleY(value)}`).join(" ");
}

function areaPath(series, width, height) {
  return `${linePath(series, width, height)} L ${width} ${height - 8} L 0 ${height - 8} Z`;
}

function renderGrid() {
  return [35, 95, 155, 215].map(y => `<line x1="0" y1="${y}" x2="680" y2="${y}" stroke="rgba(10,13,18,.075)" stroke-width="1" />`).join("");
}

/* ---------------- Preferences ---------------- */
function applyPrefs() {
  if (!el("prefRisk")) return;
  const prefs = loadPrefs();
  el("prefRisk").value = prefs.risk;
  if (el("prefHorizon")) el("prefHorizon").value = prefs.horizon;
  if (el("prefDepth")) el("prefDepth").value = prefs.depth;
  if (el("prefMaxPosition")) el("prefMaxPosition").value = prefs.maxPosition;
  if (el("prefIndustries")) el("prefIndustries").value = prefs.industries;
  if (el("prefWatch")) el("prefWatch").value = prefs.watch;
}

function savePrefs() {
  const prefs = {
    risk: el("prefRisk").value,
    horizon: el("prefHorizon")?.value || defaultPrefs.horizon,
    depth: el("prefDepth")?.value || defaultPrefs.depth,
    maxPosition: el("prefMaxPosition")?.value || defaultPrefs.maxPosition,
    industries: el("prefIndustries")?.value || "",
    watch: el("prefWatch")?.value || ""
  };
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  showToast("Preferences saved.");
}

/* ---------------- Toast + reveals ---------------- */
function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2500);
}

function showAllReveals() {
  document.querySelectorAll(".reveal:not(.visible)").forEach(el => {
    el.classList.add("visible");
    el.style.opacity = "";
    el.style.transform = "";
  });
}

function observeReveals() {
  const targets = [...document.querySelectorAll(".reveal:not(.visible)")];
  if (!targets.length) return;
  if (!("IntersectionObserver" in window) || reduceMotion()) {
    targets.forEach(target => target.classList.add("visible"));
    return;
  }
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("visible");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -7% 0px" });
  targets.forEach(target => observer.observe(target));
}

// Keep hover motion restrained. The visual response is handled in CSS with
// border, fill and arrow movement instead of bouncy scale effects.
function initHoverSprings() {}

/* ---------------- Master render ---------------- */
function render() {
  if (!state.funds.length) {
    state.funds = cloneDefaults();
    activeFundId = state.funds[0].id;
  }
  if (!state.funds.some(fund => fund.id === activeFundId)) activeFundId = state.funds[0].id;
  renderFundCards();
  renderFundSelect();
  renderTopMetrics();
  renderSummary();
  renderHoldings();
  renderWinnersLosers();
  renderChart();
  renderTape();
  initHoverSprings();
  saveState();
}

/* ---------------- Hero network canvas (interactive) ---------------- */
function initNet() {
  cycleCaption();
}

// Cycle the hero caption so it reads like the agents are talking to each other.
function cycleCaption() {
  const caption = document.getElementById("meshCaption");
  if (!caption) return;
  const lines = [
    "News → Portfolio: RKLB launch contract logged",
    "Macro → Portfolio: inflation cooling, rates steady",
    "Sentiment → Portfolio: AI hardware mood positive",
    "Portfolio → hold: Whitewater concentration high",
    "Debate → trim the software overweight? Not yet."
  ];
  let i = 0;
  setInterval(() => {
    i = (i + 1) % lines.length;
    caption.style.opacity = "0";
    setTimeout(() => { caption.textContent = lines[i]; caption.style.opacity = "1"; }, 260);
  }, 3400);
}

/* ---------------- Navigation (mobile hamburger) ---------------- */
function initNav() {
  const hamburger = el("hamburger");
  if (!hamburger) return;
  const close = () => document.body.classList.remove("nav-open");
  hamburger.addEventListener("click", () => document.body.classList.toggle("nav-open"));
  document.querySelectorAll(".mobile-nav a").forEach(link => link.addEventListener("click", close));
  document.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
}

/* ---------------- Wiring ---------------- */
// Read-only dashboard: viewers can switch the active fund and save the
// preferences that steer the AI. Portfolios are managed by the AI, not by hand.
function initEvents() {
  fundSelect?.addEventListener("change", () => { activeFundId = fundSelect.value; render(); });
  el("savePrefsButton")?.addEventListener("click", savePrefs);
}

/* ---------------- Live data from the AI backend (D1) ---------------- */
// Upgrades the built-in defaults to whatever the AI is currently running.
// Silently keeps the defaults if the API isn't there (opened locally, not yet deployed).
async function hydrateFromApi() {
  try {
    const res = await fetch("/api/funds", { headers: { accept: "application/json" } });
    if (!res.ok) return;
    const data = await res.json();
    if (!data?.funds?.length) return;
    state.funds = data.funds.map(f => ({
      id: f.code,
      name: f.name,
      code: f.code,
      risk: f.risk,
      description: f.description,
      holdings: (f.holdings || []).map(h => ({ id: h.ticker, ...h }))
    }));
    if (!state.funds.some(fund => fund.id === activeFundId)) activeFundId = state.funds[0].id;
    render();
  } catch (error) {
    // Keep the defaults.
  }
}

async function hydrateResearch() {
  const container = document.getElementById("brief");
  if (!container) return;
  try {
    const res = await fetch("/api/research", { headers: { accept: "application/json" } });
    if (!res.ok) return;
    const data = await res.json();
    if (!data?.briefs?.length) return;
    container.innerHTML = data.briefs.map((brief, index) => briefDayHtml(brief, index === 0)).join("");
    observeReveals();
  } catch (error) {
    // Keep the static placeholder brief.
  }
}

function briefDayHtml(brief, isLatest) {
  const rows = [
    ["Market", brief.market], ["Moves", brief.moves], ["Sentiment", brief.sentiment],
    ["News", brief.news], ["Coming up", brief.comingUp], ["Why", brief.why]
  ].filter(([, value]) => value);
  const dateObj = brief.date ? new Date(`${brief.date}T00:00:00`) : null;
  const dow = dateObj ? dateObj.toLocaleDateString("en-NZ", { weekday: "long" }) : "";
  const dstr = dateObj ? dateObj.toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric" }) : (brief.date || "");
  return `
    <article class="brief-day ${isLatest ? "today" : ""} reveal">
      <div class="brief-head">
        <div class="brief-date"><span class="brief-dow">${escapeHtml(dow)}</span><strong>${escapeHtml(dstr)}</strong></div>
        ${isLatest ? '<span class="brief-return positive">Latest</span>' : ""}
      </div>
      <p class="brief-lede">${escapeHtml(brief.lede || "")}</p>
      <dl class="brief-grid">
        ${rows.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}
      </dl>
    </article>
  `;
}

/* ---------------- Hero parallax ---------------- */
function initHeroParallax() {
  const img = document.querySelector(".hero-bullbear");
  const hero = document.querySelector(".hero");
  if (!img || !hero || reduceMotion()) return;

  const max = 26; // px of drift at the edges
  let raf = 0;
  const onMove = event => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const rect = hero.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;  // -0.5 .. 0.5
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      img.style.transform = `translate(${(-x * max).toFixed(1)}px, ${(-y * max).toFixed(1)}px)`;
    });
  };
  const reset = () => { img.style.transform = "translate(0px, 0px)"; };

  hero.addEventListener("mousemove", onMove);
  hero.addEventListener("mouseleave", reset);
}

/* ---------------- Page motion ---------------- */
function initPageMotion() {
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add("is-ready")));

  document.querySelectorAll('a[href$=".html"]').forEach(link => {
    link.addEventListener("click", event => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const href = link.getAttribute("href");
      if (!href || href.startsWith("#") || link.target === "_blank") return;
      event.preventDefault();
      document.body.classList.add("page-leaving");
      setTimeout(() => { window.location.href = href; }, 180);
    });
  });
}

/* ---------------- Boot ---------------- */
initPageMotion();
if (el("year")) el("year").textContent = new Date().getFullYear();
initNav();
initEvents();
initNet();
initHeroParallax();
applyPrefs();
render();
observeReveals();
refreshQuotes();
setInterval(refreshQuotes, 60000);
hydrateFromApi();
hydrateResearch();
