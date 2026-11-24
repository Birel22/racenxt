-- A car an athlete adds is theirs right away (on their page, status 'pending' = not in the shared library).
-- It only goes to the admin for review when the athlete ticks "Suggest this car for the Racenxt library".
alter table public.vehicles add column if not exists suggested boolean not null default false;
-- cars added before this were all meant for review
update public.vehicles set suggested = true where status = 'pending' and created_by_profile is not null;
