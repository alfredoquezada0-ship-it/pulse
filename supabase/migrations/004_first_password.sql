-- PULSE: people pick their own password the first time they sign in. Safe to run more than once.
alter table users add column if not exists must_change_password boolean default false;
alter table users add column if not exists password_changed_at timestamptz;
