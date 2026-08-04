/* ============================================================
   Watercooler shared app logic (page-aware)
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
    description: "Concentrated exposure to ambitious companies where upside matters more than smoothness.",
    holdings: [
      { id: uid(), ticker: "RKLB", company: "Rocket Lab", weight: 28, shares: 90, entryPrice: 24.2, currentPrice: 27.6, thesis: "Launch, space systems and long-duration infrastructure growth." },
      { id: uid(), ticker: "NVDA", company: "NVIDIA", weight: 25, shares: 12, entryPrice: 132.5, currentPrice: 146.1, thesis: "Core compute layer for accelerated AI workloads." },
      { id: uid(), ticker: "PLTR", company: "Palantir", weight: 20, shares: 35, entryPrice: 92.8, currentPrice: 98.4, thesis: "Operational AI deployment with strong government and enterprise positioning." },
      { id: uid(), ticker: "TSLA", company: "Tesla", weight: 14, shares: 7, entryPrice: 301.4, currentPrice: 285.9, thesis: "High-variance autonomy, energy and manufacturing optionality." }
    ]
  },
  {
    id: "tidewater",
    name: "Tidewater",
    code: "WTR-MD",
    risk: "Balanced",
    description: "A growth-led core with enough quality and diversification to stay invested through noise.",
    holdings: [
      { id: uid(), ticker: "MSFT", company: "Microsoft", weight: 24, shares: 8, entryPrice: 446.2, currentPrice: 462.8, thesis: "Cloud distribution, enterprise software and AI monetisation." },
      { id: uid(), ticker: "GOOGL", company: "Alphabet", weight: 20, shares: 14, entryPrice: 184.7, currentPrice: 191.3, thesis: "Search cash flows funding a broad AI and infrastructure portfolio." },
      { id: uid(), ticker: "AMZN", company: "Amazon", weight: 20, shares: 11, entryPrice: 207.4, currentPrice: 214.2, thesis: "AWS, logistics scale and operating leverage." },
      { id: uid(), ticker: "V", company: "Visa", weight: 15, shares: 9, entryPrice: 330.5, currentPrice: 338.1, thesis: "Global payment rails with resilient economics." }
    ]
  },
  {
    id: "stillwater",
    name: "Stillwater",
    code: "WTR-LO",
    risk: "Defensive",
    description: "Durable cash flows, broad market exposure and lower concentration for a calmer ride.",
    holdings: [
      { id: uid(), ticker: "VOO", company: "Vanguard S&P 500 ETF", weight: 38, shares: 10, entryPrice: 552.1, currentPrice: 563.4, thesis: "Low-cost US large-cap core exposure." },
      { id: uid(), ticker: "BRK.B", company: "Berkshire Hathaway", weight: 20, shares: 8, entryPrice: 472.2, currentPrice: 479.5, thesis: "Diversified quality assets and disciplined capital allocation." },
      { id: uid(), ticker: "COST", company: "Costco", weight: 15, shares: 3, entryPrice: 940.3, currentPrice: 956.7, thesis: "Recurring membership economics and resilient consumer loyalty." },
      { id: uid(), ticker: "BND", company: "Vanguard Total Bond Market ETF", weight: 15, shares: 20, entryPrice: 73.1, currentPrice: 73.6, thesis: "Broad fixed-income ballast." }
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
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (stored?.funds?.length) return stored;
  } catch (error) {
    console.warn("Could not read saved Watercooler data", error);
  }
  return { funds: cloneDefaults(), activeFundId: "whitewater" };
}

function saveState() {
  state.activeFundId = activeFundId;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
let editingFundId = null;
let editingHoldingId = null;

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
const fundModal = el("fundModal");
const holdingModal = el("holdingModal");
const fundForm = el("fundForm");
const holdingForm = el("holdingForm");
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
        <td>
          <div class="row-actions">
            <button class="row-button" data-edit-holding="${item.id}" title="Edit">✎</button>
            <button class="row-button" data-delete-holding="${item.id}" title="Delete">×</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  if (emptyState) emptyState.classList.toggle("visible", holdings.length === 0);
  if (holdingsTable) holdingsTable.style.display = holdings.length ? "table" : "none";

  holdingsBody.querySelectorAll("[data-edit-holding]").forEach(button =>
    button.addEventListener("click", () => openHoldingModal(button.dataset.editHolding)));
  holdingsBody.querySelectorAll("[data-delete-holding]").forEach(button =>
    button.addEventListener("click", () => deleteHolding(button.dataset.deleteHolding)));
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

function renderTape() {
  if (!marketTape) return;
  const holdings = state.funds.flatMap(fund => fund.holdings.map(item => ({ ...item, fund: fund.code })));
  const items = holdings.length ? holdings : [{ ticker: "WTR", fund: "LOCAL", entryPrice: 1, currentPrice: 1 }];
  const markup = items.map(item => {
    const move = item.entryPrice ? ((item.currentPrice - item.entryPrice) / item.entryPrice) * 100 : 0;
    return `<span class="tape-item"><span>${escapeHtml(item.ticker)}</span><span>${money(item.currentPrice, 2)}</span><b class="${move < 0 ? "negative" : ""}">${move < 0 ? "▼" : "▲"} ${signed(move, 2)}</b></span>`;
  }).join("");
  marketTape.innerHTML = markup + markup;
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
        <stop offset="0%" stop-color="rgba(11,11,11,.14)"/>
        <stop offset="100%" stop-color="rgba(11,11,11,0)"/>
      </linearGradient>
    </defs>
    ${renderGrid()}
    <path d="${areaPath(fundSeries, 680, 240)}" fill="url(#fundFill)"></path>
    <path d="${linePath(benchSeries, 680, 240)}" fill="none" stroke="rgba(11,11,11,.4)" stroke-width="2.5" stroke-dasharray="8 8"></path>
    <path d="${linePath(fundSeries, 680, 240)}" fill="none" stroke="var(--ink)" stroke-width="3.5"></path>
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
  return [35, 95, 155, 215].map(y => `<line x1="0" y1="${y}" x2="680" y2="${y}" stroke="rgba(11,11,11,.08)" stroke-width="1" />`).join("");
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

/* ---------------- Modals ---------------- */
function openFundModal(fundId = null) {
  if (!fundModal) return;
  editingFundId = fundId;
  fundForm.reset();
  el("fundModalTitle").textContent = fundId ? "Edit fund" : "Create a fund";
  el("saveFundButton").textContent = fundId ? "Update fund" : "Save fund";
  if (fundId) {
    const fund = state.funds.find(item => item.id === fundId);
    if (fund) {
      fundForm.elements.name.value = fund.name;
      fundForm.elements.code.value = fund.code;
      fundForm.elements.risk.value = fund.risk;
      fundForm.elements.description.value = fund.description || "";
    }
  }
  fundModal.showModal();
  setTimeout(() => fundForm.elements.name.focus(), 40);
}

function openHoldingModal(holdingId = null) {
  if (!holdingModal || !activeFund()) return;
  editingHoldingId = holdingId;
  holdingForm.reset();
  el("holdingModalTitle").textContent = holdingId ? "Edit position" : "Add a position";
  el("saveHoldingButton").textContent = holdingId ? "Update position" : "Save position";
  if (holdingId) {
    const holding = activeFund().holdings.find(item => item.id === holdingId);
    if (holding) Object.entries(holding).forEach(([key, value]) => {
      if (holdingForm.elements[key]) holdingForm.elements[key].value = value;
    });
  }
  holdingModal.showModal();
  setTimeout(() => holdingForm.elements.ticker.focus(), 40);
}

function deleteHolding(id) {
  const fund = activeFund();
  const holding = fund.holdings.find(item => item.id === id);
  if (!holding || !confirm(`Remove ${holding.ticker} from ${fund.name}?`)) return;
  fund.holdings = fund.holdings.filter(item => item.id !== id);
  showToast(`${holding.ticker} removed.`);
  render();
}

function deleteFund() {
  const fund = activeFund();
  if (!fund || !confirm(`Delete ${fund.name} and all of its positions?`)) return;
  state.funds = state.funds.filter(item => item.id !== fund.id);
  activeFundId = state.funds[0]?.id;
  showToast(`${fund.name} deleted.`);
  render();
}

/* ---------------- Import / export ---------------- */
function exportData() {
  const blob = new Blob([JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `watercooler-funds-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast("Fund data exported.");
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported.funds)) throw new Error("Invalid file");
      state = { funds: imported.funds, activeFundId: imported.activeFundId || imported.funds[0]?.id };
      activeFundId = state.activeFundId;
      render();
      showToast("Fund data imported.");
    } catch (error) {
      showToast("Could not import that file.");
    }
  };
  reader.readAsText(file);
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
  document.querySelectorAll(".reveal:not(.visible)").forEach(el => el.classList.add("visible"));
}

function observeReveals() {
  const targets = document.querySelectorAll(".reveal:not(.visible)");
  if (!targets.length) return;
  // No IntersectionObserver support → just show everything.
  if (!("IntersectionObserver" in window)) return showAllReveals();

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  targets.forEach(target => observer.observe(target));

  // Safety net: never let content stay hidden if the observer never fires.
  clearTimeout(observeReveals.fallback);
  observeReveals.fallback = setTimeout(showAllReveals, 1600);
}

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
  saveState();
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
function initEvents() {
  fundSelect?.addEventListener("change", () => { activeFundId = fundSelect.value; render(); });
  fundForm?.addEventListener("submit", event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(fundForm));
    const duplicate = state.funds.find(fund => fund.code.toUpperCase() === data.code.trim().toUpperCase() && fund.id !== editingFundId);
    if (duplicate) return showToast("That fund code already exists.");
    if (editingFundId) {
      const fund = state.funds.find(item => item.id === editingFundId);
      Object.assign(fund, { name: data.name.trim(), code: data.code.trim().toUpperCase(), risk: data.risk, description: data.description.trim() });
      showToast("Fund updated.");
    } else {
      const newFund = { id: uid(), name: data.name.trim(), code: data.code.trim().toUpperCase(), risk: data.risk, description: data.description.trim(), holdings: [] };
      state.funds.push(newFund);
      activeFundId = newFund.id;
      showToast("Fund created.");
    }
    fundModal.close();
    render();
  });

  holdingForm?.addEventListener("submit", event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(holdingForm));
    const fund = activeFund();
    const position = {
      ticker: data.ticker.trim().toUpperCase(),
      company: data.company.trim(),
      weight: Number(data.weight),
      shares: Number(data.shares),
      entryPrice: Number(data.entryPrice),
      currentPrice: Number(data.currentPrice),
      thesis: data.thesis.trim()
    };
    if (editingHoldingId) {
      Object.assign(fund.holdings.find(item => item.id === editingHoldingId), position);
      showToast("Position updated.");
    } else {
      fund.holdings.push({ id: uid(), ...position });
      showToast(`${position.ticker} added to ${fund.name}.`);
    }
    holdingModal.close();
    render();
  });

  document.querySelectorAll("[data-open-fund-modal]").forEach(button => button.addEventListener("click", () => openFundModal()));
  document.querySelectorAll("[data-open-holding-modal]").forEach(button => button.addEventListener("click", () => openHoldingModal()));
  el("editFundButton")?.addEventListener("click", () => openFundModal(activeFundId));
  el("deleteFundButton")?.addEventListener("click", deleteFund);
  el("exportButton")?.addEventListener("click", exportData);
  el("importInput")?.addEventListener("change", event => {
    const file = event.target.files[0];
    if (file) importData(file);
    event.target.value = "";
  });
  el("savePrefsButton")?.addEventListener("click", savePrefs);

  document.querySelectorAll("[data-close-modal]").forEach(button =>
    button.addEventListener("click", () => button.closest("dialog").close()));

  [fundModal, holdingModal].forEach(modal => {
    if (!modal) return;
    modal.addEventListener("click", event => {
      const rect = modal.getBoundingClientRect();
      const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (!inside) modal.close();
    });
  });
}

/* ---------------- Boot ---------------- */
if (el("year")) el("year").textContent = new Date().getFullYear();
initNav();
initEvents();
applyPrefs();
render();
observeReveals();
