# AI fund backend — setup (Stage 1)

This wires the site to a real AI that manages the three house funds. The pipeline:

```
POST /api/run  ->  pull live prices (Finnhub) + recent news
               ->  Claude runs the News / Macro / Sentiment / Portfolio agents
               ->  new holdings + a plain-language brief saved to D1
Frontend       ->  reads the live state from /api/funds and /api/research
```

Until you run it, the site shows its built-in defaults. Nothing breaks before setup.

## What's in the repo

- `schema.sql` — the database tables + seed data
- `functions/api/funds.js` — GET, the site reads funds/holdings here
- `functions/api/research.js` — GET, the site reads the daily briefs here
- `functions/api/run.js` — POST, the decision pipeline (token-protected)
- `functions/api/quotes.js` — the live ticker (already set up)

## Step 1 — Create the D1 database

You need the Wrangler CLI (`npm install -g wrangler`, then `wrangler login`).

```bash
wrangler d1 create watercooler
```

Copy the `database_id` it prints.

## Step 2 — Create the tables + seed data

```bash
wrangler d1 execute watercooler --file=./schema.sql --remote
```

(Use `--remote` to run against the real database, not a local copy.)

## Step 3 — Bind the database + set secrets (Cloudflare dashboard)

In your Pages project:

1. **Settings → Functions → D1 database bindings** → Add binding:
   - Variable name: `DB`
   - Database: `watercooler`
2. **Settings → Variables and secrets** → add these (use the encrypted/secret option):
   - `ANTHROPIC_API_KEY` — your Anthropic API key
   - `FINNHUB_API_KEY` — same key the ticker uses
   - `RUN_TOKEN` — any long random string you make up (this gates who can trigger a run)
   - *(optional)* `CLAUDE_MODEL` — defaults to `claude-opus-4-8`. Set to `claude-haiku-4-5` for the cheapest option.
   - *(optional)* `FUND_CAPITAL` — notional $ per fund, defaults to `100000`.
3. **Redeploy** (bindings and env vars only apply to new deployments).

## Step 4 — Run it once

Trigger a decision cycle (replace the URL and token):

```bash
curl -X POST https://your-site.pages.dev/api/run -H "x-run-token: YOUR_RUN_TOKEN"
```

You should get back `{"ok":true,...}`. Then open the site — the AI Fund page shows the
new holdings and the Research page shows the brief it just wrote.

## Step 5 — Verify

- `https://your-site.pages.dev/api/funds` returns JSON with the current holdings.
- `https://your-site.pages.dev/api/research` returns the briefs.

## How the numbers work (Stage 1)

- Each fund has a notional `FUND_CAPITAL` (default $100k).
- The AI sets **target weights**; the pipeline turns those into share counts at the live price.
- **Cost basis** is remembered per ticker (the price when it was first opened), so a position's
  return reflects how the pick has done since the AI bought it. Live prices update the value.
- Prices come from Finnhub (lightly delayed on the free tier). No real trades — model only.

## Cost

Each run is a few thousand input tokens and ~1–2k output. On `claude-opus-4-8` ($5/$25 per
million tokens) that's roughly a cent or two per run. `claude-haiku-4-5` ($1/$5) is ~5× cheaper.
At three runs a day it's cents per day either way.

## Testing locally (optional)

`python -m http.server` won't run the functions. To exercise them locally with your keys and a
local database copy:

```bash
wrangler pages dev . --d1 DB=watercooler \
  --binding ANTHROPIC_API_KEY=... FINNHUB_API_KEY=... RUN_TOKEN=devtoken
```

Then `curl -X POST http://localhost:8788/api/run -H "x-run-token: devtoken"`.

## Next (Stage 2)

Put `/api/run` on a schedule — Cloudflare **Cron Triggers**, 3× per day during US market hours
(open / midday / close). I'll wire that once you've confirmed a manual run works.

## Troubleshooting

- **401 Unauthorized** from `/api/run` — the `x-run-token` header doesn't match `RUN_TOKEN`.
- **500 "D1 database not bound"** — the `DB` binding is missing or you didn't redeploy.
- **500 "ANTHROPIC_API_KEY not set"** — add the secret and redeploy.
- **`/api/run` works but the site still shows old data** — hard-refresh; the frontend caches nothing,
  but your browser might. Confirm `/api/funds` shows the new holdings.
