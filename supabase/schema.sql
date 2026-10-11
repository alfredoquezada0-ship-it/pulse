-- PULSE database schema for Supabase (PostgreSQL).
-- Run this in the Supabase SQL editor. The API server uses the service role key;
-- Row Level Security is on with no public policies, so the browser can't read tables directly.

create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  role text not null check (role in ('manager','supervisor','agent')),
  lob text,
  supervisor_id uuid references users(id),
  manager_id uuid references users(id),
  auth_user_id uuid unique references auth.users(id) on delete set null, -- the person's Supabase login (UID)
  hire_date date,
  employee_id text unique,          -- CCMS
  roster_key text unique,           -- how the roster import recognizes this person
  sub_lob text,                     -- e.g. AM, C&B, OJT, Training
  in_production boolean default true,
  site text,
  tenure_days int,
  tenure_bucket text,
  active boolean default true,
  source text,                      -- 'roster' for people imported from the EDB files
  roster_date date,
  must_change_password boolean default false, -- true until they replace the temporary password
  password_changed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz
);

create table if not exists kpi_goals (
  id uuid primary key default gen_random_uuid(),
  lob text not null,
  kpi text not null check (kpi in ('nps','csat','fcr','aht','qa')),
  goal numeric not null,
  dir text not null check (dir in ('higher','lower')),
  created_at timestamptz default now(),
  updated_at timestamptz,
  unique (lob, kpi)
);

create table if not exists kpi_weekly (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references users(id) on delete cascade,
  week_start date not null,
  nps numeric, csat numeric, fcr numeric, aht numeric, qa numeric,
  surveys int,
  created_at timestamptz default now(),
  updated_at timestamptz,
  unique (agent_id, week_start)
);

create table if not exists verbatims (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references users(id) on delete cascade,
  date date not null,
  score int,
  text text not null,
  created_at timestamptz default now(),
  updated_at timestamptz
);

create table if not exists coaching_sessions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references users(id) on delete cascade,
  supervisor_id uuid references users(id),
  date date not null,
  status text not null default 'draft' check (status in ('draft','completed')),
  behavior text check (behavior in ('lara','ownership','expectations','needs','warm','appreciation','empathy')),
  root_cause text check (root_cause in ('knowledge','skill','will','tool_process')),
  evidence text,
  kpi_focus text,
  notes jsonb default '{}'::jsonb,
  ai jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz
);

create table if not exists commitments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references coaching_sessions(id) on delete set null,
  agent_id uuid not null references users(id) on delete cascade,
  supervisor_id uuid references users(id),
  behavior text not null check (behavior in ('lara','ownership','expectations','needs','warm','appreciation','empathy')),
  root_cause text not null check (root_cause in ('knowledge','skill','will','tool_process')),
  week_start date not null,
  action text not null,
  measure_target int,
  measure_total int,
  check_method text,
  follow_up_date date,
  evidence text,
  status text not null default 'open' check (status in ('open','met','partial','not_met')),
  monitor_hits int,
  monitor_total int,
  self_hits int default 0,
  agent_ack boolean default false,
  agent_ack_at timestamptz,
  review_notes text,
  created_at timestamptz default now(),
  updated_at timestamptz
);

create table if not exists weekly_sessions (
  id uuid primary key default gen_random_uuid(),
  supervisor_id uuid references users(id),
  agent_id uuid not null references users(id) on delete cascade,
  commitment_id uuid references commitments(id) on delete set null,
  week_start date not null,
  type text not null check (type in ('setting_goals','skill_transfer','monitor','kudos_accountability')),
  planned_date date,
  planned_time text,
  tool text check (tool in ('SBS','Remote Call Listening','Fast Ball Quizzes','Setting Expectations','Discuss','Self Tape vs. Model','Self Tape','Model Tape')),
  status text not null default 'planned' check (status in ('planned','held','rescheduled','missed')),
  reason text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz
);

create table if not exists quizzes (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references users(id) on delete cascade,
  supervisor_id uuid references users(id),
  behavior text,
  title text,
  questions jsonb not null,
  source text,
  status text not null default 'assigned' check (status in ('assigned','completed')),
  answers jsonb,
  score int,
  completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz
);

create table if not exists roleplays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  agent_id uuid references users(id) on delete cascade,
  behavior text,
  scenario jsonb,
  transcript jsonb default '[]'::jsonb,
  evaluation jsonb,
  status text default 'active',
  mood text,
  ended_at timestamptz,
  coach_note text,                 -- the supervisor's or manager's note on this practice (the agent sees it)
  coach_note_by uuid references users(id) on delete set null,
  coach_note_at timestamptz,
  sample boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz
);

create table if not exists training_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  guide_id text not null,
  completed_at date default current_date,
  created_at timestamptz default now(),
  updated_at timestamptz,
  unique (user_id, guide_id)
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link jsonb,
  key text,
  read_at timestamptz,
  sample boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz,
  unique (user_id, key)
);

create table if not exists roleplay_assignments (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references users(id) on delete cascade,
  assigned_by uuid references users(id) on delete set null,
  behavior text not null check (behavior in ('lara','ownership','expectations','needs','warm','appreciation','empathy')),
  call_type text,
  difficulty text,
  channel text default 'voice',
  due_date date,
  note text,
  status text not null default 'assigned' check (status in ('assigned','started','done','cancelled')),
  roleplay_id uuid references roleplays(id) on delete set null,
  scenario jsonb,                  -- set when the supervisor wrote or edited the scenario; used instead of a generated one
  score int,
  completed_at timestamptz,
  sample boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz
);

create table if not exists leader_sessions (
  id uuid primary key default gen_random_uuid(),
  supervisor_id uuid not null references users(id) on delete cascade,
  manager_id uuid references users(id) on delete set null,
  date date not null,
  status text not null default 'draft' check (status in ('draft','completed')),
  behavior text check (behavior in ('rhythm','direct','smart','root_cause','tool','followup')),
  root_cause text check (root_cause in ('knowledge','skill','will','tool_process')),
  evidence text,
  metrics jsonb,
  notes jsonb default '{}'::jsonb,
  sample boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz
);

create table if not exists leader_commitments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references leader_sessions(id) on delete set null,
  supervisor_id uuid not null references users(id) on delete cascade,
  manager_id uuid references users(id) on delete set null,
  behavior text not null check (behavior in ('rhythm','direct','smart','root_cause','tool','followup')),
  root_cause text not null check (root_cause in ('knowledge','skill','will','tool_process')),
  week_start date not null,
  action text not null,
  measure_target int,
  measure_total int,
  check_method text,
  follow_up_date date,
  evidence text,
  status text not null default 'open' check (status in ('open','met','partial','not_met')),
  result_value numeric,
  sup_ack boolean default false,
  sup_ack_at timestamptz,
  review_notes text,
  sample boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz
);

-- For databases created before these columns existed (same as migrations/002 and 003):
alter table users add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;
alter table users add column if not exists employee_id text unique;
alter table users add column if not exists roster_key text unique;
alter table users add column if not exists sub_lob text;
alter table users add column if not exists in_production boolean default true;
alter table users add column if not exists site text;
alter table users add column if not exists tenure_days int;
alter table users add column if not exists tenure_bucket text;
alter table users add column if not exists active boolean default true;
alter table users add column if not exists source text;
alter table users add column if not exists roster_date date;
alter table users add column if not exists must_change_password boolean default false;
alter table users add column if not exists password_changed_at timestamptz;
-- Sample (placeholder) rows, same as migrations/005:
alter table kpi_weekly add column if not exists sample boolean default false;
alter table verbatims add column if not exists sample boolean default false;
alter table coaching_sessions add column if not exists sample boolean default false;
alter table commitments add column if not exists sample boolean default false;
alter table weekly_sessions add column if not exists sample boolean default false;
alter table quizzes add column if not exists sample boolean default false;

create index if not exists idx_users_supervisor on users(supervisor_id);
create index if not exists idx_users_manager on users(manager_id);
create index if not exists idx_kpi_agent on kpi_weekly(agent_id, week_start);
create index if not exists idx_verbatims_agent on verbatims(agent_id, date);
create index if not exists idx_commitments_agent on commitments(agent_id, week_start);
create index if not exists idx_commitments_sup on commitments(supervisor_id, week_start);
create index if not exists idx_weekly_sup on weekly_sessions(supervisor_id, week_start);
create index if not exists idx_weekly_commit on weekly_sessions(commitment_id);

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

-- Notifications, assigned roleplays and manager → supervisor coaching (same as migrations/006):
create index if not exists idx_notifications_user on notifications(user_id, read_at);
create index if not exists idx_rp_assign_agent on roleplay_assignments(agent_id, status);
create index if not exists idx_leader_sessions_sup on leader_sessions(supervisor_id, date);
create index if not exists idx_leader_commitments_sup on leader_commitments(supervisor_id, week_start);

alter table notifications enable row level security;
alter table roleplay_assignments enable row level security;
alter table leader_sessions enable row level security;
alter table leader_commitments enable row level security;

-- Practice log and editable roleplay scenarios (same as migrations/007):
alter table roleplays add column if not exists ended_at timestamptz;
alter table roleplays add column if not exists coach_note text;
alter table roleplays add column if not exists coach_note_by uuid references users(id) on delete set null;
alter table roleplays add column if not exists coach_note_at timestamptz;
alter table roleplays add column if not exists sample boolean default false;
alter table roleplay_assignments add column if not exists scenario jsonb;
create index if not exists idx_roleplays_agent on roleplays(agent_id, created_at);
create index if not exists idx_roleplays_user on roleplays(user_id, created_at);

-- Supervisor-first diagnosis (same as migrations/008):
create table if not exists diagnoses (
  id uuid primary key default gen_random_uuid(),
  supervisor_id uuid references users(id) on delete set null,
  agent_id uuid not null references users(id) on delete cascade,
  week_start date not null,
  calls jsonb default '[]'::jsonb,   -- the supervisor's call listening: [{ label, marks: { behavior: 'shown'|'missed' }, note }]
  evidence_top text check (evidence_top in ('lara','ownership','expectations','needs','warm','appreciation','empathy')),  -- most-missed behavior in those calls
  sup_pick text not null check (sup_pick in ('lara','ownership','expectations','needs','warm','appreciation','empathy')),
  sup_reason text,
  ai_pick text check (ai_pick in ('lara','ownership','expectations','needs','warm','appreciation','empathy')),
  ai jsonb,                          -- the AI's second opinion
  agrees boolean,
  final_pick text check (final_pick in ('lara','ownership','expectations','needs','warm','appreciation','empathy')),
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
