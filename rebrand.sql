UPDATE funds SET name = 'Deepwater', description = 'Medium-risk, current-driven institutional growth.' WHERE code = 'WTR-MD';
UPDATE funds SET description = 'High-risk, high-velocity alpha generation from market chaos.' WHERE code = 'WTR-AG';
UPDATE funds SET description = 'Low-risk, high-certainty capital preservation.' WHERE code = 'WTR-LO';
DELETE FROM holdings;
