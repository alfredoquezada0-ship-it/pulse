-- PULSE: lock the database down. Safe to run more than once.
-- PULSE reads and writes only from its server, with the secret key. The browser only uses the public
-- (publishable) key to sign in. So: row-level security on every table with no policies (nobody can read or
-- write through the public key), and the public roles lose their table privileges too.
alter table users enable row level security;
alter table kpi_goals enable row level security;
alter table kpi_weekly enable row level security;
alter table verbatims enable row level security;
alter table coaching_sessions enable row level security;
alter table commitments enable row level security;
alter table weekly_sessions enable row level security;
alter table quizzes enable row level security;
alter table roleplays enable row level security;
alter table training_completions enable row level security;
alter table notifications enable row level security;
alter table roleplay_assignments enable row level security;
alter table leader_sessions enable row level security;
alter table leader_commitments enable row level security;
alter table diagnoses enable row level security;
alter table behaviors enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from anon, authenticated;
-- Tables created later get the same treatment.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

-- Check: every table below should show rowsecurity = true.
select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename;
