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

  renderAllHoldings(fund);
  drawChart(fund);
}

// Every position in the selected fund, with what the agents paid and where it sits now.
function renderAllHoldings(fund) {
  const body = el("allHoldingsBody");
  if (!body) return;
  if (el("allHoldingsFund")) el("allHoldingsFund").textContent = fund.name;
  if (el("allHoldingsCount")) {
    el("allHoldingsCount").textContent = `${fund.holdings.length} position${fund.holdings.length === 1 ? "" : "s"}`;
  }
  body.innerHTML = fund.holdings.map(h => {
    const entry = Number(h.entryPrice) || 0;
    const now = Number(h.currentPrice) || 0;
    const ret = entry ? ((now - entry) / entry) * 100 : 0;
    return `
      <tr>
        <td>${escapeHtml(h.company || h.ticker)}</td>
        <td class="tk">${escapeHtml(h.ticker)}</td>
        <td>${Number(h.weight || 0).toFixed(1)}%</td>
        <td>${money(entry)}</td>
        <td>${money(now)}</td>
        <td class="${ret >= 0 ? "positive" : "negative"}">${signed(ret, 2)}</td>
      </tr>`;
  }).join("");
}

// Real performance from the daily snapshots in D1, against the S&P proxy (SPY) recorded
// on the same days. No history yet means we say so rather than drawing an invented line.
const MONO = "IBM Plex Mono, monospace";

function drawChart(fund) {
  const svg = el("fundChart");
  if (!svg) return;
  svg.removeAttribute("preserveAspectRatio");

  const W = 560, H = 232, padL = 48, padR = 14, padT = 18, padB = 30;
  const hist = (fund && fund.history) || [];

  if (hist.length < 2) {
    svg.innerHTML = `
      <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="rgba(255,255,255,.09)"/>
      <text x="${W / 2}" y="${H / 2 - 6}" text-anchor="middle" fill="#6a7280" font-size="12" font-family="${MONO}">
        Performance history builds from the daily runs.
      </text>
      <text x="${W / 2}" y="${H / 2 + 14}" text-anchor="middle" fill="#4d545e" font-size="11" font-family="${MONO}">
        One point is recorded at each market close.
      </text>`;
    return;
  }

  const fundSeries = hist.map(h => Number(h.returnPct) || 0);
  const spy0 = Number(hist.find(h => Number(h.spy) > 0)?.spy) || 0;
  const spySeries = hist.map(h => (spy0 && Number(h.spy) > 0) ? ((Number(h.spy) - spy0) / spy0) * 100 : 0);

  const all = spy0 ? fundSeries.concat(spySeries) : fundSeries.slice();
  let lo = Math.min(...all, 0);
  let hi = Math.max(...all, 0);
  const headroom = Math.max(1, (hi - lo) * 0.2);
  lo -= headroom;
  hi += headroom;

  const x = i => padL + (i / (hist.length - 1)) * (W - padL - padR);
  const y = v => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const path = s => s.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");

  let grid = "";
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = lo + (i / ticks) * (hi - lo);
    grid += `<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W - padR}" y2="${y(v).toFixed(1)}"
               stroke="rgba(255,255,255,.07)" stroke-width="1" stroke-dasharray="3 5"/>
             <text x="${padL - 10}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" fill="#6a7280"
               font-size="10" font-family="${MONO}">${v >= 0 ? "+" : ""}${v.toFixed(1)}%</text>`;
  }

  const marks = [...new Set([0, Math.floor((hist.length - 1) / 2), hist.length - 1])];
  const xLabels = marks.map(i => {
    const d = new Date(`${hist[i].date}T00:00:00`);
    const label = Number.isNaN(d.getTime())
      ? hist[i].date
      : d.toLocaleDateString("en-NZ", { day: "numeric", month: "short" });
    return `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="#6a7280"
              font-size="10" font-family="${MONO}">${escapeHtml(label)}</text>`;
  }).join("");

  const area = `${path(fundSeries)} L ${x(hist.length - 1).toFixed(1)} ${y(lo)} L ${padL} ${y(lo)} Z`;
  const bench = spy0
    ? `<path d="${path(spySeries)}" fill="none" stroke="#6a7280" stroke-width="1.4" stroke-dasharray="4 4"/>`
    : "";
  const legend = `
    <line x1="${W - padR - 140}" y1="${padT - 7}" x2="${W - padR - 126}" y2="${padT - 7}" stroke="#4d8bff" stroke-width="2"/>
    <text x="${W - padR - 120}" y="${padT - 3}" fill="#949ca8" font-size="10" font-family="${MONO}">Fund</text>
    ${spy0 ? `<line x1="${W - padR - 78}" y1="${padT - 7}" x2="${W - padR - 64}" y2="${padT - 7}"
                stroke="#6a7280" stroke-width="1.4" stroke-dasharray="4 4"/>
              <text x="${W - padR - 58}" y="${padT - 3}" fill="#949ca8" font-size="10" font-family="${MONO}">S&amp;P 500</text>` : ""}`;

  svg.innerHTML = `
    <defs>
      <linearGradient id="fillGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#2563eb" stop-opacity=".32"/>
        <stop offset="100%" stop-color="#2563eb" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${grid}
    <path d="${area}" fill="url(#fillGrad)"/>
    ${bench}
    <path d="${path(fundSeries)}" fill="none" stroke="#4d8bff" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
    ${xLabels}
    ${legend}
  `;
}

/* ---------------- Commentary ---------------- */
function noteHref(brief) {
  return brief?.date ? `note.html?date=${encodeURIComponent(brief.date)}` : "note.html";
}

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
    if (el("featTitle") && b.lede) el("featTitle").textContent = b.lede;
    if (el("featDate")) el("featDate").textContent = formatDate(b.date);
    if (el("featBody")) el("featBody").textContent = b.market || b.why || b.moves || "";
    if (el("featTag")) el("featTag").textContent = "Daily note";
    if (el("featLink")) el("featLink").href = noteHref(b);

    // Previous days: date, headline, read. No tags, no filters.
    const rows = briefs.slice(1);
    if (rows.length) {
      list.innerHTML = rows.map(brief => `
        <a class="note-row" href="${noteHref(brief)}">
          <span class="date">${escapeHtml(formatDate(brief.date))}</span>
          <h3>${escapeHtml(brief.lede || brief.market || "Daily note")}</h3>
          <span class="read">Read <span aria-hidden="true">→</span></span>
        </a>`).join("");
    } else {
      list.innerHTML = `<p class="panel-note">This is the first note. Previous days will stack up here.</p>`;
    }
  } catch (error) {
    // Keep the placeholder notes.
  }
}

/* ---------------- Single note page ---------------- */
async function renderNotePage() {
  if (!el("noteTitle")) return;
  const wanted = new URLSearchParams(location.search).get("date");
  try {
    const res = await fetch("/api/research", { headers: { accept: "application/json" } });
    if (!res.ok) return;
    const data = await res.json();
    const briefs = data?.briefs || [];
    if (!briefs.length) return;
    const b = (wanted && briefs.find(x => x.date === wanted)) || briefs[0];

    if (b.lede) el("noteTitle").textContent = b.lede;
    if (el("noteDate")) el("noteDate").textContent = formatDate(b.date);
    if (el("noteStand")) el("noteStand").textContent = b.market || b.why || "";
    document.title = `LiquidAssets · ${formatDate(b.date) || "Daily note"}`;

    const blocks = [
      ["What we did", b.moves],
      ["Why we did it", b.why],
      ["How the market felt", b.sentiment],
      ["The news that mattered", b.news],
      ["What we're watching next", b.comingUp]
    ].filter(([, value]) => value);

    const body = el("noteBody");
    if (body && blocks.length) {
      body.innerHTML = blocks.map(([heading, value]) => `
        <section class="note-block">
          <h2>${escapeHtml(heading)}</h2>
          <p>${escapeHtml(value)}</p>
        </section>`).join("");
    }
  } catch (error) {
    // Keep the placeholder note.
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
    if (el("homeNote")) el("homeNote").href = noteHref(b);
  } catch (error) {
    // Keep the placeholder.
  }
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
      history: f.history || [],
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
renderHome();
renderFundsPage();
observeReveals();

hydrateFunds();
hydrateCommentary();
renderNotePage();
renderHomeNote();
refreshQuotes();
setInterval(refreshQuotes, 60000);
