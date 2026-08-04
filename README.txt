Watercooler website
===================

Open index.html in your browser, or serve the folder locally:

    python -m http.server 8080

then visit http://localhost:8080

Structure
---------
This is now a multi-page site sharing one stylesheet and one script:

- index.html     Home — statement hero, ticker, live metrics, fund summary, CTAs
- fund.html      AI Fund — the operating dashboard (fund rail, holdings manager,
                 performance vs S&P, winners/losers, future agents, preferences)
- research.html  Research — plain-language daily brief and end-of-day log
- styles.css     Shared theme (light "paper" original look, bold + industrial)
- app.js         Shared, page-aware logic (each renderer no-ops if its page
                 elements are absent, so one file safely powers all three pages)

Theme
-----
Back to the original light "paper" look: cream background, black ink, lime accent,
hard box-shadows and heavy type — simplified with more breathing room and split
across pages instead of one long scroll.

Features
--------
- Create, edit and delete funds; add, edit and remove ticker positions
- Manual target weights, units, average price and latest price
- Automatic model value, open P/L and position returns
- Performance panel (illustrative fund vs S&P 500) and winners/losers
- Personalisation preferences (risk, horizon, depth, max position, industries)
- JSON export / import, saved locally with localStorage
- Mobile hamburger navigation, scroll-reveal animations, ticker and marquee
- Respects prefers-reduced-motion

Notes
-----
No account, database or external service is required. Prices are entered manually.
Model portfolios only — not financial advice, and no trades are placed.
