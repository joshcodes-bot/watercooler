DELETE FROM holdings;
DELETE FROM briefs;
DELETE FROM runs;
DELETE FROM sqlite_sequence WHERE name IN ('holdings', 'briefs', 'runs');
