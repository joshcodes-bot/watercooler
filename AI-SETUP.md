# AI fund backend, setup (Stage 1)

This wires the site to a real AI that manages the three house funds. The pipeline:

```
POST /api/run  ->  pull live prices (Finnhub) + recent news
               ->  Claude runs the News / Macro / Sentiment / Portfolio agents
               ->  new holdings + a plain-language brief saved to D1
Frontend       ->  reads the live state from /api/funds and /api/research
```

Until you run it, the site shows its built-in defaults. Nothing breaks before setup.

You can do this entirely in the Cloudflare dashboard. No command-line tools required.

## What's in the repo

- `schema.sql` the database tables + seed data
- `functions/api/funds.js` GET, the site reads funds/holdings here
- `functions/api/research.js` GET, the site reads the daily briefs here
- `functions/api/run.js` POST, the decision pipeline (token-protected)
- `functions/api/quotes.js` the live ticker (already set up)

## Step 1: Create the D1 database (dashboard)

1. Cloudflare dashboard, left sidebar: **Storage & Databases -> D1 SQL Database**.
2. **Create database**, name it `watercooler`.

## Step 2: Create the tables + seed data (dashboard)

1. Open the `watercooler` database, go to the **Console** tab.
2. Open `schema.sql` from this folder, copy all of it, paste it into the console, and **Run**.
   (If it complains about running many statements at once, paste and run it in a few chunks.)
3. Check the **Tables** tab: you should see `funds`, `holdings`, `briefs`, `runs`, with the three
   funds and their starter holdings already in there.

## Step 3: Bind the database + set secrets (Pages project)

In your Pages project:

1. **Settings -> Functions -> D1 database bindings**, add a binding:
   - Variable name: `DB`
   - Database: `watercooler`
2. **Settings -> Variables and secrets**, add these (use the encrypted / secret option):
   - `ANTHROPIC_API_KEY` your Anthropic API key
   - `FINNHUB_API_KEY` the same key the ticker uses
   - `RUN_TOKEN` any long random string you make up (this gates who can trigger a run)
   - *(optional)* `CLAUDE_MODEL` defaults to `claude-haiku-4-5` (cheapest). Set `claude-opus-4-8` for max quality.
   - *(optional)* `FUND_CAPITAL` notional $ per fund, defaults to `100000`.
3. **Redeploy** (bindings and secrets only apply to new deployments).

## Step 4: Run it once

Trigger a decision cycle. In PowerShell:

```powershell
curl.exe -X POST https://your-site.pages.dev/api/run -H "x-run-token: YOUR_RUN_TOKEN"
```

(Use `curl.exe`, not `curl`, in PowerShell so it doesn't use the built-in alias.) You should get
back `{"ok":true,...}`. Then open the site: the AI Fund page shows the new holdings and the
Research page shows the brief it just wrote.

## Step 5: Verify

- `https://your-site.pages.dev/api/funds` returns JSON with the current holdings.
- `https://your-site.pages.dev/api/research` returns the briefs.

## How the numbers work (Stage 1)

- Each fund has a notional `FUND_CAPITAL` (default $100k).
- The AI sets **target weights**; the pipeline turns those into share counts at the live price.
- **Cost basis** is remembered per ticker (the price when it was first opened), so a position's
  return reflects how the pick has done since the AI bought it. Live prices update the value.
- Prices come from Finnhub (lightly delayed on the free tier). No real trades, model only.

## Cost

Cloudflare's free plan covers the D1 storage and function calls at this scale with room to spare.
The only paid part is the Anthropic API. Each run is a few thousand input tokens and ~1 to 2k
output. On the default `claude-haiku-4-5` ($1/$5 per million tokens) that is a fraction of a cent
per run, so three runs a day is pennies a week. `claude-opus-4-8` ($5/$25) is higher quality at
roughly 5x the cost.

## If you would rather use the command line

Everything above can also be done with Wrangler. It wasn't on your PATH (`wrangler` alone failed),
but `npx` runs it without a global install:

```powershell
npx wrangler d1 create watercooler
npx wrangler d1 execute watercooler --file=./schema.sql --remote
```

`npx wrangler login` handles auth. Bindings and secrets are still easiest in the dashboard.

## Next (Stage 2)

Put `/api/run` on a schedule: Cloudflare **Cron Triggers**, 3x per day during US market hours
(open / midday / close). I'll wire that once you've confirmed a manual run works.

## Troubleshooting

- **401 Unauthorized** from `/api/run`: the `x-run-token` header doesn't match `RUN_TOKEN`.
- **500 "D1 database not bound"**: the `DB` binding is missing, or you didn't redeploy after adding it.
- **500 "ANTHROPIC_API_KEY not set"**: add the secret and redeploy.
- **`/api/run` works but the site still shows old data**: hard-refresh. Confirm `/api/funds` shows the
  new holdings.
