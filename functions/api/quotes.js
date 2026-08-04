/**
 * Cloudflare Pages Function  ->  GET /api/quotes?symbols=RKLB,NVDA,PLTR
 *
 * Lives at functions/api/quotes.js, so it deploys automatically with the
 * site (no separate Worker). It fetches live quotes from Finnhub server-side,
 * which keeps your API key secret and avoids browser CORS problems, then
 * caches the response at the edge for 60 seconds to stay inside the free tier.
 *
 * Setup (once, in the Cloudflare Pages dashboard):
 *   Settings -> Environment variables -> add  FINNHUB_API_KEY = <your key>
 *
 * Returns: { quotes: { RKLB: { price, change, changePct }, ... }, at: "..." }
 */
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const raw = (url.searchParams.get("symbols") || "").trim();
  if (!raw) return json({ error: "No symbols requested." }, 400);

  const symbols = raw
    .split(",")
    .map(s => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 30); // guard against oversized requests

  const key = env.FINNHUB_API_KEY;
  if (!key) return json({ error: "FINNHUB_API_KEY is not set." }, 500);

  // Serve a recent cached copy if we have one (per unique symbol list).
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), request);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const quotes = {};
  await Promise.all(
    symbols.map(async symbol => {
      try {
        const r = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`,
          { cf: { cacheTtl: 60 } }
        );
        if (!r.ok) return;
        const q = await r.json();
        // Finnhub: c = current, d = change, dp = percent change.
        if (typeof q.c === "number" && q.c > 0) {
          quotes[symbol] = { price: q.c, change: q.d, changePct: q.dp };
        }
      } catch (error) {
        // Skip this symbol; the frontend falls back to the stored price.
      }
    })
  );

  const response = json({ quotes, at: new Date().toISOString() });
  response.headers.set("Cache-Control", "public, max-age=60");
  context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
