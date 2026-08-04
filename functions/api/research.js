/**
 * GET /api/research - returns the AI's recent daily briefs, newest first, from D1.
 * The Research page renders these; if D1 isn't bound it keeps its static placeholder.
 */
export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) return json({ error: "D1 database not bound" }, 500);

  try {
    const rows = (await env.DB.prepare(
      "SELECT brief_date, market_overview, market, moves, sentiment, news, coming_up, why " +
      "FROM briefs ORDER BY id DESC LIMIT 10"
    ).all()).results || [];

    const briefs = rows.map(r => ({
      date: r.brief_date,
      lede: r.market_overview,
      market: r.market,
      moves: r.moves,
      sentiment: r.sentiment,
      news: r.news,
      comingUp: r.coming_up,
      why: r.why
    }));

    return json({ briefs });
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
