/**
 * GET /api/funds - returns the funds + holdings the AI currently manages, from D1.
 * Shape matches what the frontend expects (entryPrice/currentPrice/thesis).
 * If D1 isn't bound (e.g. before setup), the frontend falls back to its built-in defaults.
 */
export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) return json({ error: "D1 database not bound" }, 500);

  try {
    const funds = (await env.DB.prepare(
      "SELECT code, name, risk, description FROM funds " +
      "ORDER BY CASE risk WHEN 'Aggressive' THEN 0 WHEN 'Balanced' THEN 1 ELSE 2 END"
    ).all()).results || [];

    const holdings = (await env.DB.prepare(
      "SELECT fund_code, ticker, company, weight, cost_basis, shares, current_price, reason FROM holdings"
    ).all()).results || [];

    // Daily snapshots so the site can chart real performance vs the S&P proxy.
    let history = [];
    try {
      history = (await env.DB.prepare(
        "SELECT fund_code, snap_date, return_pct, spy FROM history ORDER BY snap_date ASC"
      ).all()).results || [];
    } catch (_) {
      history = []; // table may not exist yet on older databases
    }
    const histByFund = {};
    for (const h of history) {
      (histByFund[h.fund_code] ||= []).push({
        date: h.snap_date,
        returnPct: h.return_pct,
        spy: h.spy
      });
    }

    const byFund = {};
    for (const h of holdings) {
      (byFund[h.fund_code] ||= []).push({
        ticker: h.ticker,
        company: h.company,
        weight: h.weight,
        shares: h.shares,
        entryPrice: h.cost_basis,
        currentPrice: h.current_price,
        thesis: h.reason
      });
    }

    const out = funds.map(f => ({
      code: f.code,
      name: f.name,
      risk: f.risk,
      description: f.description,
      holdings: byFund[f.code] || [],
      history: histByFund[f.code] || []
    }));

    return json({ funds: out });
  } catch (error) {
    return json({ error: String(error) }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
