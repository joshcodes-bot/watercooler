/**
 * POST /api/ingest - persist a decision computed by an EXTERNAL brain.
 *
 * This is the bridge for the TradingAgents Python job (running in GitHub Actions). That job
 * does all the LLM reasoning off-platform, then POSTs the finished funds + brief here. This
 * endpoint just prices the tickers and writes them to D1, so the site reads the result exactly
 * as it does today. It is the write half of the old /api/run, minus the thinking.
 *
 * Auth: header  x-run-token: <RUN_TOKEN>   (same shared token as /api/run)
 *
 * Body:
 * {
 *   "model": "tradingagents",                       // optional, logged
 *   "marketOverview": "one or two sentences",
 *   "funds": [
 *     { "code": "WTR-AG", "holdings": [
 *         { "ticker": "RKLB", "company": "Rocket Lab", "weight": 12, "action": "hold", "reason": "..." }
 *     ] }
 *   ],
 *   "brief": { "market": "...", "moves": "...", "sentiment": "...", "news": "...", "comingUp": "...", "why": "..." }
 * }
 *
 * Env: DB (D1), RUN_TOKEN, FINNHUB_API_KEY, optional FUND_CAPITAL.
 */
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.RUN_TOKEN || request.headers.get("x-run-token") !== env.RUN_TOKEN) {
    return json({ error: "Unauthorized" }, 401);
  }
  if (!env.DB) return json({ error: "D1 database not bound" }, 500);

  const capital = Number(env.FUND_CAPITAL) || 100000;
  const startedAt = new Date().toISOString();

  let decision;
  try {
    decision = await request.json();
  } catch (_) {
    return json({ error: "Body must be JSON" }, 400);
  }
  if (!decision || !Array.isArray(decision.funds)) {
    return json({ error: "Expected a JSON body with a funds array" }, 400);
  }

  try {
    // Known fund codes, and the previous holdings (to keep cost basis on continuing positions).
    const funds = (await env.DB.prepare("SELECT code FROM funds").all()).results || [];
    const validCodes = new Set(funds.map(f => f.code));
    const holdings = (await env.DB.prepare(
      "SELECT fund_code, ticker, cost_basis, current_price FROM holdings"
    ).all()).results || [];
    const prevByFund = {};
    for (const h of holdings) (prevByFund[h.fund_code] ||= {})[h.ticker] = h;

    // Price every ticker the decision names (fresh opens included).
    const decided = [...new Set(
      decision.funds.flatMap(f => (f.holdings || [])
        .map(h => String(h.ticker || "").toUpperCase().trim()))
        .filter(Boolean)
    )];
    const quotes = await fetchQuotes(decided, env.FINNHUB_API_KEY);

    const now = new Date().toISOString();
    for (const fd of decision.funds) {
      const code = fd.code;
      if (!validCodes.has(code)) continue;
      const prev = prevByFund[code] || {};

      await env.DB.prepare("DELETE FROM holdings WHERE fund_code = ?").bind(code).run();

      const inserts = [];
      for (const h of fd.holdings || []) {
        const ticker = String(h.ticker || "").toUpperCase().trim();
        if (!ticker) continue;
        const price = quotes[ticker]?.price || prev[ticker]?.current_price || 0;
        if (!price) continue; // never store a price-less position (would poison returns)
        const prevBasis = prev[ticker]?.cost_basis;
        const costBasis = (prevBasis && prevBasis > 0) ? prevBasis : price; // heal / keep basis
        const weight = Number(h.weight) || 0;
        const shares = price ? (weight / 100 * capital) / price : 0;
        inserts.push(env.DB.prepare(
          "INSERT INTO holdings (fund_code, ticker, company, weight, cost_basis, shares, current_price, action, reason, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(code, ticker, h.company || "", weight, costBasis, shares, price, h.action || "hold", h.reason || "", now));
      }
      if (inserts.length) await env.DB.batch(inserts);
    }

    // One brief per day (replace today's if it already exists).
    const b = decision.brief || {};
    const today = now.slice(0, 10);
    await env.DB.prepare("DELETE FROM briefs WHERE brief_date = ?").bind(today).run();
    await env.DB.prepare(
      "INSERT INTO briefs (brief_date, market_overview, market, moves, sentiment, news, coming_up, why, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      today, decision.marketOverview || "",
      b.market || "", b.moves || "", b.sentiment || "", b.news || "", b.comingUp || "", b.why || "", now
    ).run();

    await env.DB.prepare("INSERT INTO runs (started_at, status, model, note) VALUES (?, ?, ?, ?)")
      .bind(startedAt, "ok", decision.model || "tradingagents", `ingest: ${decided.length} tickers`).run();

    return json({ ok: true, at: now, fundsUpdated: decision.funds.length });
  } catch (error) {
    try {
      await env.DB.prepare("INSERT INTO runs (started_at, status, model, note) VALUES (?, ?, ?, ?)")
        .bind(startedAt, "error", "ingest", String(error).slice(0, 300)).run();
    } catch (_) { /* ignore logging failure */ }
    return json({ error: String(error) }, 500);
  }
}

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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
