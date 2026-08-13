/**
 * POST /api/run - runs one AI decision cycle for all house funds.
 *
 * This is a real multi-agent pipeline, not one prompt wearing four hats:
 *
 *   prices + news (Finnhub)
 *     -> News agent, Macro agent, Sentiment agent  (run in parallel, each writes a note)
 *     -> Portfolio agent  (reads the three notes + live prices, decides allocations + brief)
 *     -> holdings + brief saved to D1 -> the site reads the new state from /api/funds.
 *
 * Only the Portfolio agent has to return strict JSON. The three research agents return
 * plain text, so a wobble in one of them can never break the parse or the run.
 *
 * Protected by a shared token so randoms can't trigger it (and rack up API cost):
 *   send header  x-run-token: <RUN_TOKEN>
 *
 * Required env (set in the Cloudflare Pages dashboard):
 *   DB                 D1 binding
 *   ANTHROPIC_API_KEY  secret
 *   FINNHUB_API_KEY    secret (already used by /api/quotes)
 *   RUN_TOKEN          secret - any long random string you choose
 * Optional env:
 *   CLAUDE_MODEL       the DECISION model (Portfolio agent). Defaults to "claude-haiku-4-5";
 *                      set "claude-opus-4-8" for sharper judgement. This is the one worth upgrading.
 *   RESEARCH_MODEL     the three research agents (News/Macro/Sentiment). Defaults to "claude-haiku-4-5"
 *                      and should usually stay there - they just summarise inputs, so Opus is wasted on them.
 *   FUND_CAPITAL       notional $ per fund, defaults to 100000
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  const model = env.CLAUDE_MODEL || "claude-haiku-4-5";           // decision (Portfolio agent)
  const researchModel = env.RESEARCH_MODEL || "claude-haiku-4-5"; // research agents stay cheap

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

    // 2. Live signals: prices for held names, macro ETFs for the macro read, and recent news.
    const tickers = [...new Set(holdings.map(h => h.ticker))];
    const [quotes, macro, news] = await Promise.all([
      fetchQuotes(tickers, env.FINNHUB_API_KEY),
      fetchQuotes(MACRO_TICKERS, env.FINNHUB_API_KEY),
      fetchNews(tickers.slice(0, 8), env.FINNHUB_API_KEY)
    ]);

    // 3. Research agents - three specialists, run in parallel, each returns a short note.
    const [newsNote, macroNote, sentimentNote] = await Promise.all([
      newsAgent(env, researchModel, news, tickers),
      macroAgent(env, researchModel, macro),
      sentimentAgent(env, researchModel, holdings, quotes)
    ]);
    const research = { news: newsNote, macro: macroNote, sentiment: sentimentNote };

    // 4. Portfolio agent - the only one that must return strict JSON.
    const decision = await portfolioAgent(env, model, funds, holdingsByFund, quotes, research, capital);

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
        if (!price) continue; // never store a position with no usable price (would poison returns)
        // Keep the basis of a continuing position, but heal a missing/zero basis to the first real price
        // so returns start from where the AI actually opened it, not from 0.
        const prevBasis = prev[ticker]?.cost_basis;
        const costBasis = (prevBasis && prevBasis > 0) ? prevBasis : price;
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
      .bind(startedAt, "ok", model, `${tickers.length} tickers priced, research ${researchModel}, decision ${model}`).run();

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

// A compact palette of ETFs that stands in for "the market" so the Macro agent
// reasons over real moves: broad indices, small caps, key sectors, bonds and gold.
const MACRO_TICKERS = ["SPY", "QQQ", "DIA", "IWM", "XLK", "XLE", "XLF", "TLT", "GLD"];
const MACRO_LABELS = {
  SPY: "S&P 500", QQQ: "Nasdaq 100", DIA: "Dow", IWM: "Small caps",
  XLK: "Tech sector", XLE: "Energy sector", XLF: "Financials sector",
  TLT: "Long bonds", GLD: "Gold"
};

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

/* ---------------- Research agents ---------------- */
// Shared voice for the research notes. They write for the Portfolio agent, not the public,
// so they stay short and signal-dense. No em dashes anywhere (house style).
const HOUSE_STYLE = "Be plain-spoken, decisive and a little Kiwi. Never invent numbers; use only what is given. Do not use em dashes anywhere.";

async function newsAgent(env, model, news, tickers) {
  const body = news.length ? news.map(n => `- ${n}`).join("\n") : "(no fresh headlines available)";
  const system =
    "You are the News agent on an AI fund desk. From the headlines, pull out only what could move the " +
    "held names or their sectors: catalysts, risks, earnings, guidance, deals. " + HOUSE_STYLE;
  const user =
    `Held tickers: ${tickers.join(", ") || "(none yet)"}\n\nRecent headlines:\n${body}\n\n` +
    "Write 3 to 5 short bullet points on what actually matters for these positions today. If nothing is material, say so.";
  return research(env, model, system, user);
}

async function macroAgent(env, model, macro) {
  const rows = MACRO_TICKERS
    .filter(t => macro[t])
    .map(t => `  ${MACRO_LABELS[t]} (${t}): ${macro[t].price}${Number.isFinite(macro[t].changePct) ? ` (${macro[t].changePct.toFixed(2)}% today)` : ""}`);
  const body = rows.length ? rows.join("\n") : "(macro quotes unavailable)";
  const system =
    "You are the Macro agent on an AI fund desk. Read the market-wide tape: risk-on or risk-off, which " +
    "sectors lead or lag, and what bonds (TLT) and gold (GLD) imply about rates and fear. " + HOUSE_STYLE;
  const user = `Today's macro tape:\n${body}\n\nWrite 3 to 4 short bullets on the regime and what it favours or punishes right now.`;
  return research(env, model, system, user);
}

async function sentimentAgent(env, model, holdings, quotes) {
  const rows = holdings.map(h => {
    const q = quotes[h.ticker];
    const move = q && Number.isFinite(q.changePct) ? `${q.changePct.toFixed(2)}%` : "n/a";
    return `  ${h.ticker}: ${move} today`;
  });
  const body = rows.length ? [...new Set(rows)].join("\n") : "(no positions yet)";
  const system =
    "You are the Sentiment agent on an AI fund desk. From today's price action across the held names, " +
    "read momentum and crowd mood: broad strength, broad flush, or rotation between names. " + HOUSE_STYLE;
  const user = `Today's moves in the held names:\n${body}\n\nWrite 2 to 4 short bullets on momentum and mood. Flag anything overheated or capitulating.`;
  return research(env, model, system, user);
}

// Runs one research agent. Never throws: a failed specialist degrades to a note, not a dead run.
async function research(env, model, system, user) {
  try {
    const text = await askClaude(env, model, system, user, 700);
    return text.trim() || "(no read)";
  } catch (error) {
    return `(agent unavailable: ${String(error).slice(0, 120)})`;
  }
}

/* ---------------- Portfolio agent ---------------- */
async function portfolioAgent(env, model, funds, holdingsByFund, quotes, research, capital) {
  const system =
    "You are the Portfolio agent and head of desk at Watercooler, an AI fund manager running model " +
    "portfolios only - no real trades are placed. Three research agents just reported: News, Macro and " +
    "Sentiment. Weigh their notes against each fund's risk mandate and set today's allocations, then write " +
    "the public daily brief. You run a CONTINUING book, not a blank slate each day: you are judged on steady " +
    "returns over time, so prize conviction and low turnover. Default to holding good positions. Be decisive " +
    "and plain-spoken, a little Kiwi in tone. Explain every call in one sentence. Never invent prices; use the " +
    "ones provided. Do not use em dashes anywhere.";
  const user = buildPortfolioPrompt(funds, holdingsByFund, quotes, research, capital);
  return callClaudeJson(env, model, system, user);
}

function buildPortfolioPrompt(funds, holdingsByFund, quotes, research, capital) {
  const lines = [];
  lines.push("RESEARCH DESK NOTES (from your three agents):");
  lines.push("\n[News agent]\n" + (research.news || "(none)"));
  lines.push("\n[Macro agent]\n" + (research.macro || "(none)"));
  lines.push("\n[Sentiment agent]\n" + (research.sentiment || "(none)"));

  lines.push(`\nEach fund has notional capital of $${capital}. Set a target weight % per holding (roughly summing to 100% per fund). Keep 4 to 8 holdings per fund, real tickers only. Respect each fund's risk mandate above all.`);

  lines.push("\nCONTINUITY RULES (this is an existing book, not a fresh build):");
  lines.push("  - Default to holding. Only act when a desk note gives a real reason.");
  lines.push("  - At most about 2 changes per fund this run (an open, a close, or a meaningful trim). Do not rebuild a fund from scratch.");
  lines.push("  - Keep most weight moves modest; a larger shift is fine only when a clear catalyst justifies it.");
  lines.push("  - Preserve winners and let them run; trim or close only on a genuine thesis break or risk flag, not on noise.");

  lines.push("\nRETURN TARGETS (manage toward the mandate, do not chase headlines):");
  lines.push("  - Whitewater (WTR-AG, Aggressive): high growth, aim well above the market, tolerate volatility.");
  lines.push("  - Tidewater (WTR-MD, Balanced): steady compounding, beat the index with controlled drawdown.");
  lines.push("  - Stillwater (WTR-LO, Defensive): capital preservation first, low drawdown, modest steady gains.");
  lines.push("\nCURRENT FUNDS AND HOLDINGS:");
  for (const f of funds) {
    lines.push(`\n${f.name} (${f.code}) - ${f.risk} - ${f.description}`);
    const held = holdingsByFund[f.code] || [];
    if (!held.length) lines.push("  (empty - build this fund from scratch)");
    for (const h of held) {
      const q = quotes[h.ticker];
      const price = q ? q.price : h.current_price;
      const move = q && Number.isFinite(q.changePct) ? ` (${q.changePct.toFixed(2)}% today)` : "";
      lines.push(`  ${h.ticker} ${h.company || ""} | target ${h.weight}% | cost ${h.cost_basis} | now ${price}${move}`);
    }
  }

  lines.push("\nDecide each fund's holdings for today - hold, add, trim, open or close - grounded in the desk notes, then write a short plain-language daily brief.");
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
async function askClaude(env, model, system, user, maxTokens) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens || 4000,
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
  return block ? block.text : "";
}

async function callClaudeJson(env, model, system, user) {
  const text = await askClaude(env, model, system, user, 8000);
  return parseJson(text);
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
