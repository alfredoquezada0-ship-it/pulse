-- PULSE: practice log (details of every roleplay) and scenarios the supervisor writes or edits. Safe to run more than once.
alter table roleplays add column if not exists ended_at timestamptz;
alter table roleplays add column if not exists coach_note text;
alter table roleplays add column if not exists coach_note_by uuid references users(id) on delete set null;
alter table roleplays add column if not exists coach_note_at timestamptz;
alter table roleplays add column if not exists sample boolean default false;
alter table roleplay_assignments add column if not exists scenario jsonb;
create index if not exists idx_roleplays_agent on roleplays(agent_id, created_at);
create index if not exists idx_roleplays_user on roleplays(user_id, created_at);
