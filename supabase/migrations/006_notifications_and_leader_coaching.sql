-- PULSE: notifications, assigned roleplays, and manager → supervisor coaching. Safe to run more than once.
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

create index if not exists idx_notifications_user on notifications(user_id, read_at);
create index if not exists idx_rp_assign_agent on roleplay_assignments(agent_id, status);
create index if not exists idx_leader_sessions_sup on leader_sessions(supervisor_id, date);
create index if not exists idx_leader_commitments_sup on leader_commitments(supervisor_id, week_start);

alter table notifications enable row level security;
alter table roleplay_assignments enable row level security;
alter table leader_sessions enable row level security;
alter table leader_commitments enable row level security;
