/**
 * POST /api/run - runs one AI decision cycle for all house funds.
 *
 *   prices (Finnhub)  +  recent news  ->  Claude decides allocations + writes a brief
 *   -> holdings + brief saved to D1 -> the site reads the new state from /api/funds.
 *
 * Protected by a shared token so randoms can't trigger it (and rack up API cost):
 *   send header  x-run-token: <RUN_TOKEN>
 *
 * Required env (set in the Cloudflare Pages dashboard):
 *   DB               D1 binding
 *   ANTHROPIC_API_KEY  secret
 *   FINNHUB_API_KEY    secret (already used by /api/quotes)
 *   RUN_TOKEN          secret - any long random string you choose
 * Optional env:
 *   CLAUDE_MODEL     defaults to "claude-haiku-4-5" (cheapest); set "claude-opus-4-8" for max quality
 *   FUND_CAPITAL     notional $ per fund, defaults to 100000
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  const model = env.CLAUDE_MODEL || "claude-haiku-4-5";

  if (!env.RUN_TOKEN || request.headers.get("x-run-token") !== env.RUN_TOKEN) {
    return json({ error: "Unauthorized" }, 401);
  }
  if (!env.DB) return json({ error: "D1 database not bound" }, 500);
  if (!env.ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY not set" }, 500);

  const capital = Number(env.FUND_CAPITAL) || 100000;
  const startedAt = new Date().toISOString();

  try {
    // 1. Current state
    const funds = (await env.DB.prepare("SELECT code, name, risk, description FROM funds").all()).results || [];
    const holdings = (await env.DB.prepare(
      "SELECT fund_code, ticker, company, weight, cost_basis, shares, current_price FROM holdings"
    ).all()).results || [];
    const holdingsByFund = {};
    for (const h of holdings) (holdingsByFund[h.fund_code] ||= []).push(h);

    // 2. Live prices + 3. recent news
    const tickers = [...new Set(holdings.map(h => h.ticker))];
    const quotes = await fetchQuotes(tickers, env.FINNHUB_API_KEY);
    const news = await fetchNews(tickers.slice(0, 8), env.FINNHUB_API_KEY);

    // 4. Ask Claude to run the four agents and decide
    const system =
      "You are Watercooler, an AI fund manager running four research agents: News, Macro, " +
      "Sentiment and Portfolio. You manage model portfolios only - no real trades are placed. " +
      "Be decisive, plain-spoken and a little Kiwi in tone. Explain every call in one sentence. " +
      "Never invent prices; use the ones provided. Stay true to each fund's risk mandate. " +
      "Do not use em dashes anywhere in your writing.";
    const user = buildPrompt(funds, holdingsByFund, quotes, news, capital);
    const decision = await callClaude(env, model, system, user);

    // 5. Apply the decision to D1
    const now = new Date().toISOString();
    for (const fd of decision.funds || []) {
      const code = fd.code;
      if (!funds.some(f => f.code === code)) continue;

      const prev = {};
      for (const h of (holdingsByFund[code] || [])) prev[h.ticker] = h;

      await env.DB.prepare("DELETE FROM holdings WHERE fund_code = ?").bind(code).run();

      const inserts = [];
      for (const h of fd.holdings || []) {
        const ticker = String(h.ticker || "").toUpperCase().trim();
        if (!ticker) continue;
        const price = quotes[ticker]?.price || prev[ticker]?.current_price || 0;
        const costBasis = prev[ticker] ? prev[ticker].cost_basis : (price || 0); // keep basis if held
        const weight = Number(h.weight) || 0;
        const shares = price ? (weight / 100 * capital) / price : 0;
        inserts.push(env.DB.prepare(
          "INSERT INTO holdings (fund_code, ticker, company, weight, cost_basis, shares, current_price, action, reason, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(code, ticker, h.company || "", weight, costBasis, shares, price, h.action || "hold", h.reason || "", now));
      }
      if (inserts.length) await env.DB.batch(inserts);
    }

    // 6. Save the brief
    const b = decision.brief || {};
    await env.DB.prepare(
      "INSERT INTO briefs (brief_date, market_overview, market, moves, sentiment, news, coming_up, why, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      now.slice(0, 10), decision.marketOverview || "",
      b.market || "", b.moves || "", b.sentiment || "", b.news || "", b.comingUp || "", b.why || "", now
    ).run();

    // 7. Log the run
    await env.DB.prepare("INSERT INTO runs (started_at, status, model, note) VALUES (?, ?, ?, ?)")
      .bind(startedAt, "ok", model, `${tickers.length} tickers priced`).run();

    return json({ ok: true, at: now, model, fundsUpdated: (decision.funds || []).length });
  } catch (error) {
    try {
      await env.DB.prepare("INSERT INTO runs (started_at, status, model, note) VALUES (?, ?, ?, ?)")
        .bind(startedAt, "error", model, String(error).slice(0, 300)).run();
    } catch (_) { /* ignore logging failure */ }
    return json({ error: String(error) }, 500);
  }
}

/* ---------------- Signals ---------------- */
async function fetchQuotes(symbols, key) {
  const out = {};
  if (!key) return out;
  await Promise.all(symbols.map(async symbol => {
    try {
      const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`);
      if (!r.ok) return;
      const q = await r.json();
      if (typeof q.c === "number" && q.c > 0) out[symbol] = { price: q.c, changePct: q.dp };
    } catch (_) { /* skip */ }
  }));
  return out;
}

async function fetchNews(symbols, key) {
  const out = [];
  if (!key) return out;
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  await Promise.all(symbols.map(async symbol => {
    try {
      const r = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${key}`);
      if (!r.ok) return;
      const arr = await r.json();
      for (const n of (arr || []).slice(0, 2)) if (n.headline) out.push(`${symbol}: ${n.headline}`);
    } catch (_) { /* skip */ }
  }));
  return out.slice(0, 20);
}

/* ---------------- Prompt ---------------- */
function buildPrompt(funds, holdingsByFund, quotes, news, capital) {
  const lines = [];
  lines.push(`Each fund has notional capital of $${capital}. Set a target weight % per holding (roughly summing to 100% per fund). Keep 4 to 8 holdings per fund, real tickers only.`);
  lines.push("\nCURRENT FUNDS AND HOLDINGS:");
  for (const f of funds) {
    lines.push(`\n${f.name} (${f.code}) - ${f.risk} - ${f.description}`);
    for (const h of (holdingsByFund[f.code] || [])) {
      const q = quotes[h.ticker];
      const price = q ? q.price : h.current_price;
      const move = q && Number.isFinite(q.changePct) ? ` (${q.changePct.toFixed(2)}% today)` : "";
      lines.push(`  ${h.ticker} ${h.company || ""} | target ${h.weight}% | cost ${h.cost_basis} | now ${price}${move}`);
    }
  }
  lines.push("\nRECENT NEWS HEADLINES:");
  for (const n of news) lines.push(`  - ${n}`);
  if (!news.length) lines.push("  (no fresh headlines available)");
  lines.push("\nDecide each fund's holdings for today - hold, add, trim, open or close - then write a short plain-language daily brief.");
  lines.push('\nReturn ONLY a JSON object, no markdown and no prose, with exactly this shape:');
  lines.push('{');
  lines.push('  "marketOverview": "one or two sentences on the day",');
  lines.push('  "funds": [');
  lines.push('    { "code": "WTR-AG", "holdings": [ { "ticker": "RKLB", "company": "Rocket Lab", "weight": 25, "action": "hold", "reason": "one sentence" } ] }');
  lines.push('  ],');
  lines.push('  "brief": { "market": "...", "moves": "...", "sentiment": "...", "news": "...", "comingUp": "...", "why": "..." }');
  lines.push('}');
  return lines.join("\n");
}

/* ---------------- Claude ---------------- */
async function callClaude(env, model, system, user) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      // No thinking config: on Haiku/Opus 4.8 this runs without thinking (fast + cheap);
      // it also keeps the request valid across models that configure thinking differently.
      system,
      messages: [{ role: "user", content: user }]
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  if (data.stop_reason === "refusal") throw new Error("Model declined the request");
  const block = (data.content || []).find(b => b.type === "text");
  return parseJson(block ? block.text : "");
}

function parseJson(text) {
  let t = (text || "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
