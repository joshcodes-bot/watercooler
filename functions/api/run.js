/**
 * POST /api/run - runs one AI decision cycle for all house funds.
 *
 * A full agent desk, in the order a real one works:
 *
 *   prices + news (Finnhub)
 *     -> Analysts: News, Macro, Sentiment          (parallel, each writes a note)
 *     -> Researchers: Bull vs Bear                 (parallel, argue the book independently)
 *     -> Risk officer                              (stress-tests both cases per mandate, can veto)
 *     -> Portfolio manager                         (weighs the lot, sets allocations + writes the note)
 *     -> holdings + daily history snapshot + brief saved to D1
 *     -> the site reads the new state from /api/funds and /api/research.
 *
 * Only the Portfolio manager has to return strict JSON. Every other agent returns plain
 * text, so a wobble in one of them degrades to a missing note, never a dead run.
 *
 * Seven agent calls plus the data fetches must stay inside Cloudflare's 50-subrequest cap
 * on the free plan, which is what the subrequest budget constants below are for.
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

    // 2. Live signals. Cloudflare's free plan allows 50 subrequests per invocation and every
    // quote, news lookup and agent call is one of them, so each fetch is capped to keep the
    // whole desk (7 agent calls) comfortably inside the budget.
    const tickers = [...new Set(holdings.map(h => h.ticker))].slice(0, QUOTE_LIMIT);
    const [quotes, macro, news] = await Promise.all([
      fetchQuotes(tickers, env.FINNHUB_API_KEY),
      fetchQuotes(MACRO_TICKERS, env.FINNHUB_API_KEY),
      fetchNews(tickers.slice(0, NEWS_LIMIT), env.FINNHUB_API_KEY)
    ]);

    // 3. Analysts - three specialists in parallel, each returning a short note.
    const [newsNote, macroNote, sentimentNote] = await Promise.all([
      newsAgent(env, researchModel, news, tickers),
      macroAgent(env, researchModel, macro),
      sentimentAgent(env, researchModel, holdings, quotes)
    ]);
    const research = { news: newsNote, macro: macroNote, sentiment: sentimentNote };

    // 3b. The book, described once and handed to every downstream agent.
    const book = describeBook(funds, holdingsByFund, quotes);

    // 4. Researchers - a bull and a bear build their cases independently, in parallel, so
    // neither is anchored on the other's reasoning.
    const [bullCase, bearCase] = await Promise.all([
      bullAgent(env, researchModel, research, book),
      bearAgent(env, researchModel, research, book)
    ]);
    const debate = { bull: bullCase, bear: bearCase };

    // 5. Risk officer - stress-tests the debate against each fund's mandate before anything is sized.
    const riskNote = await riskAgent(env, researchModel, research, debate, book);

    // 6. Portfolio manager - weighs the lot. The only agent that must return strict JSON.
    const decision = await portfolioAgent(
      env, model, funds, holdingsByFund, quotes, research, debate, riskNote, book, capital
    );

    // 4b. The AI can open tickers we never priced (a fresh build starts from an empty table, so
    // step 2 priced nothing, and any brand-new pick is unpriced too). Fetch quotes for those now,
    // otherwise every new position is dropped by the price guard below and the funds stay empty.
    const decided = [...new Set(
      (decision.funds || []).flatMap(f => (f.holdings || [])
        .map(h => String(h.ticker || "").toUpperCase().trim()))
        .filter(Boolean)
    )];
    // Whatever subrequests are left after the held quotes, macro, news and the seven agent
    // calls can go on pricing brand-new picks. On a rebuild from empty that is nearly all of them.
    const alreadySpent = tickers.length + MACRO_TICKERS.length
      + Math.min(tickers.length, NEWS_LIMIT) + AGENT_CALLS;
    const newPickBudget = Math.max(0, SUBREQUEST_CAP - SAFETY_MARGIN - alreadySpent);
    const unpriced = decided.filter(t => !quotes[t]).slice(0, newPickBudget);
    if (unpriced.length) Object.assign(quotes, await fetchQuotes(unpriced, env.FINNHUB_API_KEY));

    // 5. Apply the decision to D1
    const now = new Date().toISOString();
    const snapshots = [];
    for (const fd of decision.funds || []) {
      const code = fd.code;
      if (!funds.some(f => f.code === code)) continue;

      const prev = {};
      for (const h of (holdingsByFund[code] || [])) prev[h.ticker] = h;

      await env.DB.prepare("DELETE FROM holdings WHERE fund_code = ?").bind(code).run();

      const inserts = [];
      let fundValue = 0, fundCost = 0;
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
        fundValue += shares * price;
        fundCost += shares * costBasis;
      }
      if (inserts.length) await env.DB.batch(inserts);
      snapshots.push({
        code,
        value: fundValue,
        ret: fundCost ? ((fundValue - fundCost) / fundCost) * 100 : 0
      });
    }

    // 5b. Snapshot today's value for every fund, plus the S&P proxy price, so the site can
    // chart real performance against a real benchmark instead of guessing at a shape.
    const today = now.slice(0, 10);
    const spyPrice = macro?.SPY?.price || 0;
    if (snapshots.length) {
      await env.DB.prepare("DELETE FROM history WHERE snap_date = ?").bind(today).run();
      await env.DB.batch(snapshots.map(s => env.DB.prepare(
        "INSERT INTO history (fund_code, snap_date, value, return_pct, spy) VALUES (?, ?, ?, ?, ?)"
      ).bind(s.code, today, s.value, s.ret, spyPrice)));
    }

    // 6. Save the brief - exactly one per day. Clear today's first so multiple runs in a
    // day overwrite the same brief instead of stacking duplicate posts.
    const b = decision.brief || {};
    await env.DB.prepare("DELETE FROM briefs WHERE brief_date = ?").bind(today).run();
    await env.DB.prepare(
      "INSERT INTO briefs (brief_date, market_overview, market, moves, sentiment, news, coming_up, why, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      today, decision.marketOverview || "",
      b.market || "", b.moves || "", b.sentiment || "", b.news || "", b.comingUp || "", b.why || "", now
    ).run();

    // 7. Log the run
    await env.DB.prepare("INSERT INTO runs (started_at, status, model, note) VALUES (?, ?, ?, ?)")
      .bind(startedAt, "ok", model,
        `desk: 3 analysts + bull/bear debate + risk + PM | ${tickers.length} tickers priced | ` +
        `research ${researchModel}, decision ${model}`).run();

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

/* Subrequest budget. Cloudflare's free plan caps a single invocation at 50 outbound requests
   (D1 calls do not count). The desk always spends 7 on agent calls, so the data fetches have
   to fit in what is left. The new-pick allowance is worked out at runtime rather than fixed,
   because a rebuild from an empty book spends nothing on held quotes and needs the room. */
const SUBREQUEST_CAP = 50;
const SAFETY_MARGIN = 4;
const AGENT_CALLS = 7;
const QUOTE_LIMIT = 24;
const NEWS_LIMIT = 4;

// A compact palette of ETFs that stands in for "the market" so the Macro agent reasons over
// real moves. SPY doubles as the S&P benchmark recorded in the daily history snapshot.
const MACRO_TICKERS = ["SPY", "QQQ", "IWM", "TLT", "GLD"];
const MACRO_LABELS = {
  SPY: "S&P 500", QQQ: "Nasdaq 100", IWM: "Small caps",
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
  return runAgent(env, model, system, user);
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
  return runAgent(env, model, system, user);
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
  return runAgent(env, model, system, user);
}

// Runs one text agent. Never throws: a failed specialist degrades to a note, not a dead run.
async function runAgent(env, model, system, user, maxTokens = 700) {
  try {
    const text = await askClaude(env, model, system, user, maxTokens);
    return text.trim() || "(no read)";
  } catch (error) {
    return `(agent unavailable: ${String(error).slice(0, 120)})`;
  }
}

/* ---------------- Shared context ---------------- */
// The three analyst notes, formatted once for every downstream agent.
function deskNotes(research) {
  return [
    "ANALYST NOTES",
    "\n[News]\n" + (research.news || "(none)"),
    "\n[Macro]\n" + (research.macro || "(none)"),
    "\n[Sentiment]\n" + (research.sentiment || "(none)")
  ].join("\n");
}

// The current book: every fund, its mandate, and each position's price and return so far.
function describeBook(funds, holdingsByFund, quotes) {
  const lines = [];
  for (const f of funds) {
    lines.push(`\n${f.name} (${f.code}) - ${f.risk} - ${f.description}`);
    const held = holdingsByFund[f.code] || [];
    if (!held.length) lines.push("  (empty - needs building from scratch)");
    for (const h of held) {
      const q = quotes[h.ticker];
      const price = q ? q.price : h.current_price;
      const move = q && Number.isFinite(q.changePct) ? ` (${q.changePct.toFixed(2)}% today)` : "";
      const ret = h.cost_basis ? ((price - h.cost_basis) / h.cost_basis * 100) : 0;
      lines.push(
        `  ${h.ticker} ${h.company || ""} | target ${h.weight}% | cost ${h.cost_basis} | now ${price}${move}` +
        ` | return ${ret >= 0 ? "+" : ""}${ret.toFixed(1)}% since we opened it`
      );
    }
  }
  return lines.join("\n");
}

/* ---------------- Researchers: the bull / bear debate ---------------- */
async function bullAgent(env, model, research, book) {
  const system =
    "You are the Bull researcher on an AI fund desk. Argue the constructive case for the book as it stands: " +
    "where the upside is, which positions have earned more room, what the desk is underrating. " +
    "You are not a cheerleader. A weak point gets torn apart by the Bear, so only make arguments you can " +
    "defend with something in the notes or the numbers. " + HOUSE_STYLE;
  const user =
    `${deskNotes(research)}\n\nTHE BOOK:\n${book}\n\n` +
    "Make the bull case in 4 to 6 short bullets. Name specific holdings and say what you would add to or hold.";
  return runAgent(env, model, system, user);
}

async function bearAgent(env, model, research, book) {
  const system =
    "You are the Bear researcher on an AI fund desk. Argue the sceptical case for the book as it stands: " +
    "what is stretched, what is crowded, which positions have run too far, what breaks if the mood turns. " +
    "Do not be contrarian for its own sake. Only make arguments you can defend with something in the notes " +
    "or the numbers. " + HOUSE_STYLE;
  const user =
    `${deskNotes(research)}\n\nTHE BOOK:\n${book}\n\n` +
    "Make the bear case in 4 to 6 short bullets. Name specific holdings and say what you would trim or avoid.";
  return runAgent(env, model, system, user);
}

/* ---------------- Risk officer ---------------- */
async function riskAgent(env, model, research, debate, book) {
  const system =
    "You are the Risk officer on an AI fund desk. You do not pick winners. You judge whether the book is " +
    "safe for each fund's stated mandate: concentration, correlation between holdings, how much of a fund " +
    "sits in one theme, and whether the defensive fund is actually defensive. You have the authority to veto. " +
    "Be specific about which fund has which problem. " + HOUSE_STYLE;
  const user =
    `${deskNotes(research)}\n\nTHE BOOK:\n${book}\n\n` +
    `BULL CASE:\n${debate.bull}\n\nBEAR CASE:\n${debate.bear}\n\n` +
    "Write 3 to 5 short bullets. For each fund, flag any real risk in the current book or in what the bull " +
    "is proposing, and say plainly what the Portfolio manager must not do today.";
  return runAgent(env, model, system, user);
}

/* ---------------- Portfolio agent ---------------- */
async function portfolioAgent(env, model, funds, holdingsByFund, quotes, research, debate, riskNote, book, capital) {
  const system =
    "You are the Portfolio manager and head of desk at LiquidAssets, an AI fund manager running model " +
    "portfolios only - no real trades are placed. Your desk has already reported: three analysts (News, " +
    "Macro, Sentiment), a Bull and a Bear who argued the book, and a Risk officer who stress-tested it. " +
    "Your job is to weigh all of it and set today's allocations, then write the public daily note. " +
    "The Risk officer can veto: if they say a fund must not do something, you do not do it. " +
    "Where the Bull and Bear disagree, pick a side and say why in one plain sentence. " +
    "You run a CONTINUING book, not a blank slate each day: you are judged on steady returns over time, so " +
    "prize conviction and low turnover. Default to holding good positions. " +
    "Never invent prices; use the ones provided. " +
    "The public note is read by ordinary people with no finance background, so write it the way you would " +
    "explain your day to a friend who has never bought a share. Warm, direct, jargon-free. " +
    "Do not use em dashes anywhere.";
  const user = buildPortfolioPrompt(funds, holdingsByFund, quotes, research, debate, riskNote, book, capital);
  return callClaudeJson(env, model, system, user);
}

function buildPortfolioPrompt(funds, holdingsByFund, quotes, research, debate, riskNote, book, capital) {
  const lines = [];
  lines.push(deskNotes(research));

  lines.push("\nTHE DEBATE (your two researchers argued this book independently):");
  lines.push("\n[Bull case]\n" + (debate.bull || "(none)"));
  lines.push("\n[Bear case]\n" + (debate.bear || "(none)"));

  lines.push("\nRISK OFFICER (this one can veto you - do not override a hard no):");
  lines.push("\n" + (riskNote || "(no risk review available)"));

  lines.push(`\nEach fund has notional capital of $${capital}. Set a target weight % per holding (roughly summing to 100% per fund). Hold 8 to 9 positions per fund, never fewer than 8, real tickers only. Respect each fund's risk mandate above all.`);
  lines.push("This runs at the market close: judge each existing position on its return since we opened it (shown per holding), let winners run, trim names that have got extended, and cut ones whose thesis has broken. Base today's decisions on that performance.");

  lines.push("\nCONTINUITY RULES (this is an existing book, not a fresh build):");
  lines.push("  - Default to holding. Only act when a desk note gives a real reason.");
  lines.push("  - At most about 2 changes per fund this run (an open, a close, or a meaningful trim). Do not rebuild a fund from scratch.");
  lines.push("  - Keep most weight moves modest; a larger shift is fine only when a clear catalyst justifies it.");
  lines.push("  - Preserve winners and let them run; trim or close only on a genuine thesis break or risk flag, not on noise.");

  lines.push("\nMANDATES AND HOUSE FLAVOUR (these are tilts to lean into, not a script - you are AI-controlled, so use your own research to choose the actual names and back each with a reason from the desk notes):");
  lines.push("  - Whitewater (WTR-AG, Aggressive): high growth, aim well above the market, tolerate volatility. This is where we play with the big high-velocity innovators - space and frontier names in the spirit of ASTS and RKLB, AI and disruptive growth. Swing for it.");
  lines.push("  - Tidewater (WTR-MD, Balanced): steady compounding with controlled drawdown. Lean stable: broad index funds and quality healthcare, durable compounders. Stability comes first here.");
  lines.push("  - Stillwater (WTR-LO, Defensive): capital preservation first, low drawdown, modest steady gains. Lean defensive: broad index and bond funds, staples, gold, low-volatility quality.");
  lines.push("  - Across the whole book, favour industries that lean toward innovation: space, AI, tech, construction and healthcare. Keep a genuine mix and do not stack the same mega-cap in every fund; each fund should have its own character.");
  lines.push("  - Hold 8 to 9 positions per fund (never fewer than 8). Prefer real conviction picks over filler.");
  lines.push("\nCURRENT FUNDS AND HOLDINGS:");
  lines.push(book);

  lines.push("\nDecide each fund's holdings for today - hold, add, trim, open or close - grounded in the analyst notes, the debate and the risk review, then write the public daily note.");
  lines.push("Where the Bull and the Bear disagree on a name, come off the fence: pick a side and justify it in the holding's one-sentence reason.");

  lines.push("\nWRITING THE PUBLIC NOTE (this matters as much as the trades):");
  lines.push("The reader is a normal person with no finance background. They do not know what a tape, risk-off, breadth, basis points, flows or hedging are. Write so your mum could follow it.");
  lines.push("  - \"marketOverview\" is the HEADLINE. Make it a short, human hook, the way you would open a message to a friend. A question or a plain statement. Good shapes: \"Feeling nervous? We thought the same.\" / \"A quiet day, and we barely touched a thing.\" / \"Gold had a big day. Here is what we made of it.\"");
  lines.push("  - Never write a headline that is a dense summary with a colon in the middle. Never put jargon in the headline. Keep it under about 12 words.");
  lines.push("  - Every other field is 2 to 4 short sentences. Move in this order: what happened, what that means, what we did about it.");
  lines.push("  - Write as \"we\" and \"our agents\". Talk to the reader as \"you\" where it helps.");
  lines.push("  - If a market term is unavoidable, explain it in the same breath, for example \"hedging, which means buying a bit of protection in case things turn\".");
  lines.push("  - Round numbers and say them plainly: \"gold is up about 2%\" beats \"XAU +1.97%\".");
  lines.push("  - Banned phrasing: \"quiet tape\", \"nervous edge\", \"eke out\", \"risk-off\", \"risk-on\", \"constructive\", \"bid\", \"flows\", \"breadth\", \"positioning\", \"conviction\" used as a noun, and any sentence that assumes the reader already trades.");
  lines.push("  - Always finish the thought. If you say the crowd is cautious, say what that means for the money we manage.");

  lines.push("\nWhat each field should cover, all in that same plain voice:");
  lines.push("  market      - what actually happened in the market today.");
  lines.push("  moves       - what we bought, sold or held, and in which fund.");
  lines.push("  sentiment   - how investors were feeling, and why that matters.");
  lines.push("  news        - the news that mattered, and why it matters to what we own.");
  lines.push("  comingUp    - what we are watching next, and why the reader should care.");
  lines.push("  why         - the reasoning behind today's decision, spelled out simply.");

  lines.push("\nReturn ONLY a JSON object, no markdown and no prose, with exactly this shape:");
  lines.push('{');
  lines.push('  "marketOverview": "the plain-English headline hook",');
  lines.push('  "funds": [');
  lines.push('    { "code": "WTR-AG", "holdings": [ { "ticker": "RKLB", "company": "Rocket Lab", "weight": 25, "action": "hold", "reason": "one plain sentence" } ] }');
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
