-- Automatic AI checks.
-- Every 15 minutes (04:00–21:45 UTC) pg_cron pings the agent ("tick"). The agent asks due_checks() what is due
-- and starts a few checks. Each check first compares the official pages with last time and skips the AI if
-- nothing changed (free). Rules:
--   * calendar: once a month per championship
--   * race week: every day from 6 days before the start until the timetable AND where-to-watch are in
--     (paused while a proposal for that race waits for review)
--   * final: one check 2–3 days before the start, always with the AI
--   * a target is checked at most once a day, and there's a daily cap on AI checks

create extension if not exists pg_cron;

-- Settings the admin can change
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
create policy settings_admin on public.app_settings for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
insert into public.app_settings (key, value) values
  ('auto_checks', '{"enabled": true, "daily_ai_limit": 40, "per_tick": 3}')
on conflict (key) do nothing;

-- Shared secret between pg_cron and the agent (RLS on, no policies: only the service role can read it)
create table if not exists public.agent_secrets (key text primary key, value text not null);
alter table public.agent_secrets enable row level security;
insert into public.agent_secrets (key, value)
  values ('cron', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

create index if not exists check_runs_event_day on public.check_runs (event_id, ran_at desc);
create index if not exists check_runs_series_day on public.check_runs (series_id, ran_at desc);

-- What is due right now (called by the agent with the service role)
create or replace function public.due_checks(p_limit int default 3)
returns table (kind text, series_id uuid, event_id uuid, label text)
language sql stable security definer set search_path = '' as $$
  with cfg as (select coalesce((value->>'enabled')::boolean, true) as enabled,
                      coalesce((value->>'daily_ai_limit')::int, 40) as cap
               from public.app_settings where key = 'auto_checks'),
  used as (select count(*) as n from public.check_runs r
           where r.ran_at >= date_trunc('day', now()) and r.kind in ('monthly','weekly','daily','final')
             and r.result not in ('skipped_unchanged')),
  ev as (
    select case when e.start_date - current_date between 2 and 3
                 and not exists (select 1 from public.check_runs r where r.event_id = e.id and r.kind = 'final')
                then 'final' else 'daily' end as kind,
           e.series_id, e.id as event_id, s.short_name || ' ' || e.name as label, e.start_date as sort1, 0 as sort2
    from public.events e join public.series s on s.id = e.series_id
    where e.end_date >= current_date and e.start_date <= current_date + 6
      and not exists (select 1 from public.check_runs r where r.event_id = e.id and r.ran_at >= date_trunc('day', now()))
      and not exists (select 1 from public.proposals p where p.event_id = e.id and p.status = 'pending')
      and (
        e.watch_url is null
        or not exists (select 1 from public.sessions x where x.event_id = e.id)
        or (e.start_date - current_date between 2 and 3
            and not exists (select 1 from public.check_runs r where r.event_id = e.id and r.kind = 'final'))
      )
  ),
  se as (
    select 'monthly' as kind, s.id as series_id, null::uuid as event_id, s.short_name || ' calendar' as label,
           current_date + 30 as sort1, 1 as sort2
    from public.series s
    where coalesce((select max(r.ran_at) from public.check_runs r
                    where r.series_id = s.id and r.event_id is null and r.kind in ('discover','monthly')
                      and r.result <> 'error'), s.created_at) < now() - interval '30 days'
      and not exists (select 1 from public.check_runs r where r.series_id = s.id and r.event_id is null and r.ran_at >= date_trunc('day', now()))
  )
  select d.kind, d.series_id, d.event_id, d.label
  from (select * from ev union all select * from se) d, cfg, used
  where cfg.enabled and used.n < cfg.cap
  order by d.sort2, d.sort1
  limit greatest(0, least(p_limit, (select cap from cfg) - (select n from used)));
$$;
revoke all on function public.due_checks(int) from public, anon, authenticated;
grant execute on function public.due_checks(int) to service_role;

-- The cron job: pings the agent with the shared secret
select cron.unschedule('agent-tick') where exists (select 1 from cron.job where jobname = 'agent-tick');
select cron.schedule('agent-tick', '*/15 4-21 * * *', $cron$
  select net.http_post(
    url := 'https://cfpbrfqdtgwpxthehpgz.supabase.co/functions/v1/agent',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-secret', (select value from public.agent_secrets where key = 'cron')),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 20000
  );
$cron$);
