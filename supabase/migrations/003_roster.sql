-- PULSE: fields for importing the real roster (EDB files). Safe to run more than once.
alter table users add column if not exists employee_id text unique;          -- CCMS
alter table users add column if not exists roster_key text unique;           -- how the roster import recognizes this person
alter table users add column if not exists sub_lob text;                     -- e.g. AM, C&B, OJT, Training
alter table users add column if not exists in_production boolean default true; -- false for Training, OJT, Uptraining, Staff
alter table users add column if not exists site text;
alter table users add column if not exists tenure_days int;
alter table users add column if not exists tenure_bucket text;
alter table users add column if not exists active boolean default true;     -- false when someone leaves the roster
alter table users add column if not exists source text;                     -- 'roster' for imported people
alter table users add column if not exists roster_date date;
create index if not exists idx_users_manager on users(manager_id);
create index if not exists idx_users_role_active on users(role, active);
