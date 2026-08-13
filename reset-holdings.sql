-- Fresh start: clear the holdings table so the next /api/run rebuilds every
-- position at today's live price. After this + one run, cost_basis == current_price
-- for every holding, so all returns begin at 0.00% (a true "first add").
--
-- Run this in the Cloudflare dashboard: D1 -> watercooler -> Console tab -> paste -> Run.
-- Funds and briefs are left untouched; only holdings are cleared.

DELETE FROM holdings;
