-- Louis: formats change often (more or fewer practice / qualifying sessions), so the usual format is only a hint
-- for the AI, never a rule. A timetable counts as found when it has a race session, unless the agent's last look
-- said only part of it is published ("complete": false). And no "followed" filter for now: every championship is
-- searched (to bring back only if costs grow with many championships).
create or replace function private.tt_complete(p_event uuid) returns boolean
language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.sessions where event_id = p_event and type = 'race')
     and coalesce((select not (r.trace->'answer'->>'complete' = 'false' and r.trace->'answer'->>'timetable_found' = 'true')
                   from public.check_runs r where r.event_id = p_event and r.result in ('proposal', 'no_change')
                   order by r.ran_at desc limit 1), true)
$$;

create or replace function public.due_checks(p_limit integer default 3)
returns table(kind text, series_id uuid, event_id uuid, label text)
language sql stable security definer set search_path to '' as $function$
  with cfg as (select coalesce((value->>'enabled')::boolean, true) as enabled,
                      coalesce((value->>'daily_ai_limit')::int, 40) as cap
               from public.app_settings where key = 'auto_checks'),
  used as (select count(*) as n from public.check_runs r
           where r.ran_at >= date_trunc('day', now()) and r.kind in ('monthly','weekly','daily','final')
             and r.result not in ('skipped_unchanged')),
  evs as (
    select e.*, s.short_name, e.start_date - current_date as d,
           private.tt_complete(e.id) as has_tt,
           least(30, coalesce(src.tt_lead_days + 7, 30)) as start_at,
           (select max(r.ran_at) from public.check_runs r where r.event_id = e.id and r.result <> 'error') as last_run,
           exists (select 1 from public.check_runs r where r.event_id = e.id and r.kind = 'final') as had_final
    from public.events e join public.series s on s.id = e.series_id
    left join public.series_sources src on src.series_id = e.series_id
    where e.end_date >= current_date and e.start_date <= current_date + 30
      and not exists (select 1 from public.check_runs r where r.event_id = e.id and r.ran_at >= date_trunc('day', now()))
      and not exists (select 1 from public.check_runs r where r.event_id = e.id and r.result = 'running' and r.ran_at > now() - interval '15 minutes')
      and not exists (select 1 from public.proposals p where p.event_id = e.id and p.status = 'pending')
  ),
  ev as (
    select case when d between 2 and 3 and not had_final then 'final'
                when d <= 6 then 'daily' else 'weekly' end as kind,
           series_id, id as event_id, short_name || ' ' || name as label, start_date as sort1, 0 as sort2
    from evs
    where (d between 2 and 3 and not had_final)
       or (d <= 6 and (not has_tt or watch_url is null))
       or (not has_tt and d between 7 and least(14, start_at) and (last_run is null or last_run < now() - interval '3 days'))
       or (not has_tt and d between 15 and start_at and (last_run is null or last_run < now() - interval '7 days'))
  ),
  se as (
    select 'monthly' as kind, s.id as series_id, null::uuid as event_id, s.short_name || ' calendar' as label,
           current_date + 30 as sort1, 1 as sort2
    from public.series s
    where coalesce((select max(r.ran_at) from public.check_runs r
                    where r.series_id = s.id and r.event_id is null and r.kind in ('discover','monthly')
                      and r.result <> 'error'), s.created_at) < now() - interval '30 days'
      and not exists (select 1 from public.check_runs r where r.series_id = s.id and r.event_id is null and r.ran_at >= date_trunc('day', now()))
  ),
  regular as (
    select d.* from (select * from ev union all select * from se) d, cfg, used
    where used.n < cfg.cap
  ),
  initial as (
    select distinct on (e.series_id) 'initial' as kind, e.series_id, e.id as event_id, s.short_name || ' ' || e.name as label, e.start_date as sort1, 2 as sort2
    from public.events e join public.series s on s.id = e.series_id
    where e.end_date >= current_date and e.start_date > current_date + 30 and e.year <= extract(year from current_date)::int + 1
      and not private.tt_complete(e.id)
      and not exists (select 1 from public.check_runs r where r.event_id = e.id)
      and not exists (select 1 from public.proposals p where p.event_id = e.id and p.status = 'pending')
      and not exists (select 1 from public.check_runs r join public.events x on x.id = r.event_id
                      where x.series_id = e.series_id and r.result = 'running' and r.ran_at > now() - interval '15 minutes')
      and (select count(*) from public.check_runs r join public.events x on x.id = r.event_id
           where x.series_id = e.series_id and r.kind = 'initial' and r.result = 'no_change'
             and r.summary like 'Timetable not published%' and r.ran_at > now() - interval '90 days') < 2
    order by e.series_id, e.start_date
  )
  select d.kind, d.series_id, d.event_id, d.label
  from (select * from regular union all select * from initial) d, cfg
  where cfg.enabled
  order by d.sort2, d.sort1
  limit greatest(0, p_limit);
$function$;
