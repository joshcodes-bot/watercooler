# Live stock data: how it works and how to switch it on

The ticker at the top of every page can show real, near-live quotes. Here is the
whole picture, then the four steps to turn it on.

## The idea in one paragraph

A browser can't get stock prices on its own. Something has to fetch them from a
data provider, and that provider needs an API key you must not expose in public
page code. So we put a tiny piece of server code in front of it. When the site
loads, the page asks its own address (`/api/quotes?symbols=RKLB,NVDA,...`). That
request hits a **Cloudflare Pages Function** that fetches the quotes from Finnhub
using your secret key, caches the result for 60 seconds, and hands back clean
JSON. The page never sees the key, and there are no cross-site (CORS) problems
because the request stays on your own domain.

```
Browser ──/api/quotes──▶ Pages Function ──with secret key──▶ Finnhub
   ▲                          │
   └────────── JSON ──────────┘   (cached 60s at the edge)
```

If that function isn't available (you opened the file locally, you're offline, or
the key isn't set), the ticker silently falls back to the prices stored in the
app. The site never breaks.

## What's already in the repo

- `functions/api/quotes.js`, the server code. In Cloudflare Pages, any file under
  `functions/` automatically becomes a live endpoint when you deploy. No separate
  Worker, no extra deploy step. This one answers `GET /api/quotes`.
- `app.js`, already calls `/api/quotes` on load and every 60 seconds, updates the
  ticker, and shows a pulsing **Live** badge when real quotes arrive.

You don't need to edit either file. You just need a key and one setting.

## Step 1: Get a free Finnhub key

1. Go to https://finnhub.io and sign up (free).
2. Copy your API key from the dashboard.

The free tier covers US stocks and is fine for this ticker. Prices may be lightly
delayed; true real-time streaming is a paid feature, which you don't need yet.

## Step 2: Push the files to your repo

Drag the whole folder (including the new `functions/` directory) into git and
push, exactly as you've been doing. Cloudflare Pages picks up `functions/`
on the next deploy.

## Step 3: Add the key in Cloudflare (this is the important one)

In the Cloudflare dashboard:

1. Open your Pages project.
2. **Settings → Environment variables**.
3. Add a variable:
   - Name: `FINNHUB_API_KEY`
   - Value: your key
   - Use the **encrypted / secret** option so it isn't readable.
4. Save, then **redeploy** (env vars only apply to new deployments).

## Step 4: Check it

- Visit `https://your-site.pages.dev/api/quotes?symbols=RKLB,NVDA` in a browser.
  You should get JSON like `{"quotes":{"RKLB":{"price":27.6,...}},"at":"..."}`.
- Open the site. Within a second the ticker updates and a green **Live** badge
  appears at the left of the tape.

## Testing on your own machine (optional)

`python -m http.server` serves the static files but does **not** run the function,
so `/api/quotes` will 404 and the ticker just uses stored prices. To run the
function locally with your key:

```bash
npx wrangler pages dev . --binding FINNHUB_API_KEY=your_key_here
```

Then open the URL Wrangler prints (not the python one).

## Good to know

- **Only the ticker is live right now.** Your funds' holdings still use the prices
  you type in, on purpose, that keeps each fund a clean model portfolio. Later we
  can add a "Sync live prices" button that pulls quotes into the holdings too.
- **Caching + limits.** Responses are cached 60s at the edge, so lots of visitors
  won't burn through the Finnhub free limit (60 calls/min).
- **Swapping providers.** If you'd rather use Twelve Data or another source, only
  `functions/api/quotes.js` changes; the frontend contract (`{ quotes: { SYM:
  { price, change, changePct } } }`) stays the same.
- **Later: market feel.** The same function can fetch sector ETFs (XLK, XLE, XLF,
  and so on) to drive a "highlighted industry" or overall-market read in the tape.

## Troubleshooting

- **No Live badge after deploy.** Check the env var name is exactly
  `FINNHUB_API_KEY` and that you redeployed after adding it.
- **`/api/quotes` returns 500 "FINNHUB_API_KEY is not set".** The variable didn't
  reach this deployment. Re-add it and redeploy.
- **Some tickers missing.** A symbol the provider doesn't cover simply falls back
  to its stored price. `BRK.B` and most large ETFs are supported.
