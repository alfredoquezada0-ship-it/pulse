-- Run this once if you already ran schema.sql before logins were linked by UID.
alter table users add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;

-- Link existing logins to their PULSE profile by email (one time).
update users u set auth_user_id = a.id
from auth.users a
where u.auth_user_id is null and lower(a.email) = lower(u.email);

-- Check: people without a login yet
select name, email, role from users where auth_user_id is null order by role, name;
