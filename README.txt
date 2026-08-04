Watercooler website
===================

Open index.html in your browser, or serve the folder locally:

    python -m http.server 8080

then visit http://localhost:8080

Structure
---------
A multi-page site sharing one stylesheet and one script.

- index.html            Home: hero, live ticker, metrics, the three funds
- fund.html             AI Fund: funds, holdings manager, performance vs S&P,
                        winners and losers, the agents, and preferences
- research.html         Research: a sequential day-by-day market brief
- styles.css            Shared theme (light "paper" look, bold and industrial)
- app.js                Shared, page-aware logic; each renderer no-ops if its
                        page elements are absent, so one file powers all pages
- logo.png              Brand logo used in the header and footer
- functions/api/quotes.js   Cloudflare Pages Function for live stock quotes
- LIVE-DATA.md          How to switch the live ticker on (read this first)

Theme
-----
The original light "paper" look: cream background, black ink, lime accent, hard
box-shadows and heavy type. Voice is plain and human. No em dashes.

Features
--------
- Create, edit and delete funds; add, edit and remove ticker positions
- Manual target weights, units, average price and latest price
- Automatic model value, open P/L and position returns
- Clear High / Medium / Low risk badges and meters
- Performance panel (illustrative fund vs S&P 500) and winners and losers
- Personalisation preferences (risk, horizon, depth, max position, industries)
- JSON export and import, saved locally with localStorage
- Mobile hamburger navigation, scroll-reveal animations, count-up metrics
- Live ticker via a Cloudflare Pages Function (falls back to stored prices)
- Respects prefers-reduced-motion

Live data
---------
The top ticker can show real quotes once deployed on Cloudflare Pages with a free
Finnhub API key. Full setup is in LIVE-DATA.md. Until then it uses stored prices.

Notes
-----
No account or database is required yet. Holdings prices are entered manually.
Model portfolios only. Not financial advice, and no trades are placed.
