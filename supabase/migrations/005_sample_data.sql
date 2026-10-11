-- PULSE: placeholder ("sample") data for the real roster, so the screens can be explored before real KPIs
-- are loaded. Every sample row is tagged and removed in one step from Data upload › Sample data.
alter table kpi_weekly add column if not exists sample boolean default false;
alter table verbatims add column if not exists sample boolean default false;
alter table coaching_sessions add column if not exists sample boolean default false;
alter table commitments add column if not exists sample boolean default false;
alter table weekly_sessions add column if not exists sample boolean default false;
alter table quizzes add column if not exists sample boolean default false;
create index if not exists idx_kpi_sample on kpi_weekly(sample) where sample;
