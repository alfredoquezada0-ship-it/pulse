-- PULSE: the supervisor picks the behavior to coach from their own call listening, then gets the AI's second opinion.
-- Managers see how each supervisor diagnoses (calibration). Safe to run more than once.
create table if not exists diagnoses (
  id uuid primary key default gen_random_uuid(),
  supervisor_id uuid references users(id) on delete set null,
  agent_id uuid not null references users(id) on delete cascade,
  week_start date not null,
  calls jsonb default '[]'::jsonb,   -- the supervisor's call listening: [{ label, marks: { behavior: 'shown'|'missed' }, note }]
  evidence_top text,  -- most-missed behavior in those calls
  sup_pick text not null,
  sup_reason text,
  ai_pick text,
  ai jsonb,                          -- the AI's second opinion
  agrees boolean,
  final_pick text,
  final_reason text,
  status text not null default 'draft' check (status in ('draft','final')),
  session_id uuid references coaching_sessions(id) on delete set null,
  sample boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz
);
create index if not exists idx_diagnoses_sup on diagnoses(supervisor_id, week_start);
create index if not exists idx_diagnoses_agent on diagnoses(agent_id, week_start);
alter table diagnoses enable row level security;
