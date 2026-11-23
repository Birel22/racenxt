-- What the agent did on each run (searches, pages opened, its answer), shown on the admin Agent page
alter table public.check_runs add column if not exists trace jsonb;
-- Extra rules the team adds for every task, edited on the Agent page
insert into public.app_settings (key, value) values ('agent_guidance', '{"text": ""}'::jsonb) on conflict (key) do nothing;
