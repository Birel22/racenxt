-- Timetable search rules (Louis, 24 Nov 2026):
--  * After a calendar is added: races are searched one by one in date order; after 2 races without a timetable, stop.
--  * Then nothing until 1 month before a race: once a week from D-30, twice a week from D-14, every day in race week,
--    until the timetable is found.
--  * Kept: a final check at D-3/D-2 (catches changes), and the race's own where-to-watch link searched daily in race week.
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
           exists (select 1 from public.sessions x where x.event_id = e.id) as has_tt,
           (select max(r.ran_at) from public.check_runs r where r.event_id = e.id and r.result <> 'error') as last_run,
           exists (select 1 from public.check_runs r where r.event_id = e.id and r.kind = 'final') as had_final
    from public.events e join public.series s on s.id = e.series_id
    where e.end_date >= current_date
      and not exists (select 1 from public.check_runs r where r.event_id = e.id and r.ran_at >= date_trunc('day', now()))
      and not exists (select 1 from public.check_runs r where r.event_id = e.id and r.result = 'running' and r.ran_at > now() - interval '15 minutes')
      and not exists (select 1 from public.proposals p where p.event_id = e.id and p.status = 'pending')
  ),
  ev as (
    select case when d between 2 and 3 and not had_final then 'final'
                when d <= 6 then 'daily' else 'weekly' end as kind,
           series_id, id as event_id, short_name || ' ' || name as label, start_date as sort1, 0 as sort2
    from evs
    where (d between 2 and 3 and not had_final)                                                     -- final check
       or (d <= 6 and (not has_tt or watch_url is null))                                            -- race week: every day
       or (not has_tt and d between 7 and 14 and (last_run is null or last_run < now() - interval '3 days'))   -- twice a week
       or (not has_tt and d between 15 and 30 and (last_run is null or last_run < now() - interval '7 days'))  -- once a week
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
  -- right after a calendar is added: the next race without a timetable, one race at a time per championship,
  -- until 2 of them had no timetable published (races within a month are handled by the rules above)
  initial as (
    select distinct on (e.series_id) 'initial' as kind, e.series_id, e.id as event_id, s.short_name || ' ' || e.name as label, e.start_date as sort1, 2 as sort2
    from public.events e join public.series s on s.id = e.series_id
    where e.end_date >= current_date and e.start_date > current_date + 30 and e.year <= extract(year from current_date)::int + 1
      and not exists (select 1 from public.sessions x where x.event_id = e.id)
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
