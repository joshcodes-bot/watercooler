LiquidAssets website — V3
=========================

Open index.html directly, or serve the folder locally:

    python -m http.server 8080

Then visit http://localhost:8080

Pages
-----
- index.html      Home, hero, scrolling market tape, metrics, agents and fund summaries
- fund.html       AI funds, holdings, performance, winners/losers and preferences
- research.html   Daily market and fund brief
- styles.css      Shared responsive design and animation system
- app.js          Shared page-aware data, rendering and API logic

Design
------
This version is intentionally simpler and bolder: black, off-white and LiquidAssets blue,
strong geometric type, square edges, fewer effects and clear information hierarchy.
The header logo is now inline SVG plus live text, so it remains crisp and never displays
an awkward black rectangle or background.

Ticker
------
The ticker is rendered twice in app.js as two identical groups. CSS continuously moves the
combined strip by half its total width, producing a seamless full-width marquee. It uses the
existing /api/quotes endpoint when available and stored prices as a fallback.

Backend
-------
The existing API contract is unchanged. Keep or add your Cloudflare Pages functions directory
when deploying. See LIVE-DATA.md and AI-SETUP.md.

Notes
-----
Model portfolios only. Not financial advice. No real trades are placed.
