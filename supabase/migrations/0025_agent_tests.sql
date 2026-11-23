-- Agent tests: the answer key (cases) and each test run's score.
create table if not exists public.agent_test_cases (id text primary key, sort int not null default 0, data jsonb not null, updated_at timestamptz not null default now());
create table if not exists public.agent_test_runs (id uuid primary key default gen_random_uuid(), case_id text not null references public.agent_test_cases(id) on delete cascade,
  status text not null default 'running' check (status in ('running','done','error')), score numeric, max numeric, details jsonb, usage jsonb, trace jsonb, error text,
  created_at timestamptz not null default now(), finished_at timestamptz);
create index if not exists agent_test_runs_case_idx on public.agent_test_runs(case_id, created_at desc);
alter table public.agent_test_cases enable row level security;
alter table public.agent_test_runs enable row level security;
drop policy if exists agent_test_cases_admin on public.agent_test_cases;
create policy agent_test_cases_admin on public.agent_test_cases for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists agent_test_runs_admin on public.agent_test_runs;
create policy agent_test_runs_admin on public.agent_test_runs for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
-- The cases themselves are loaded from agent-tests/answer_key.json by the agent function (action "test_cases").
