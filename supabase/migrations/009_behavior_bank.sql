-- PULSE: each manager's behavior bank (the behaviors their supervisors coach, and how to do each one on the call).
-- Behaviors are no longer limited to the built-in 7, so the old checks on behavior columns are removed. Safe to run more than once.
alter table coaching_sessions drop constraint if exists coaching_sessions_behavior_check;
alter table commitments drop constraint if exists commitments_behavior_check;
alter table roleplay_assignments drop constraint if exists roleplay_assignments_behavior_check;
alter table diagnoses drop constraint if exists diagnoses_evidence_top_check;
alter table diagnoses drop constraint if exists diagnoses_sup_pick_check;
alter table diagnoses drop constraint if exists diagnoses_ai_pick_check;
alter table diagnoses drop constraint if exists diagnoses_final_pick_check;
create table if not exists behaviors (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid not null references users(id) on delete cascade,
  key text not null,                 -- what sessions, commitments and roleplays store (the 7 built-in ones keep their ids)
  name text not null,
  full_name text,
  description text,
  when_in_call jsonb default '[]'::jsonb,
  how jsonb default '[]'::jsonb,         -- how the manager wants it done on the call, step by step
  sounds jsonb default '[]'::jsonb,      -- lines the agent can say word for word
  avoid jsonb default '[]'::jsonb,
  driver text,                           -- the member complaint it prevents
  kpis jsonb default '[]'::jsonb,
  keywords jsonb default '[]'::jsonb,    -- words in survey comments that point to it
  actions jsonb default '[]'::jsonb,     -- on-call actions for SMART commitments
  listen_for jsonb default '[]'::jsonb,  -- what supervisors listen for when monitoring
  lobs jsonb default '[]'::jsonb,        -- empty = every LOB
  active boolean default true,
  position int default 0,
  ai_drafted boolean default false,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz,
  unique (manager_id, key)
);
create index if not exists idx_behaviors_manager on behaviors(manager_id, position);
alter table behaviors enable row level security;
