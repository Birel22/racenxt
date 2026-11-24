-- 1. Each championship learns its weekend format (how many practice / qualifying / race sessions) from the first
--    complete timetable approved; a timetable only counts as found when it has at least that (before: at least a race).
-- 2. It also learns where its timetable is published and how many days before the race, to search there first and
--    start at the right moment (never earlier than D-30).
-- 3. Races are only searched automatically when a published athlete races in them (their championship that year,
--    minus rounds they hid).
alter table public.series add column if not exists weekend_format jsonb;
alter table public.series_sources add column if not exists tt_url text;
alter table public.series_sources add column if not exists tt_lead_days int;

-- is this race's timetable complete for its championship?
create or replace function private.tt_complete(p_event uuid) returns boolean
language sql stable security definer set search_path to '' as $$
  with c as (select type, count(*) n from public.sessions where event_id = p_event group by type),
  f as (select s.weekend_format fmt from public.events e join public.series s on s.id = e.series_id where e.id = p_event)
  select exists (select 1 from c) and case
    when (select fmt from f) is null then exists (select 1 from c where type = 'race')
    else not exists (select 1 from jsonb_each_text((select fmt from f)) k
                     where k.value::int > coalesce((select n from c where c.type = k.key), 0))
  end
$$;

-- does a published athlete race in it?
create or replace function private.event_followed(p_event uuid) returns boolean
language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.events e
    join public.entries en on en.series_id = e.series_id and en.year = e.year
    join public.profiles p on p.id = en.profile_id and p.published
    where e.id = p_event
      and not exists (select 1 from public.event_overrides o where o.profile_id = p.id and o.event_id = e.id and o.hidden))
$$;

-- learn from an approved timetable
create or replace function private.learn_timetable() returns trigger
language plpgsql security definer set search_path to '' as $$
declare e public.events; fmt jsonb; lead int;
begin
  select * into e from public.events where id = new.event_id;
  if e.id is null or e.series_id is null then return null; end if;
  select jsonb_object_agg(type, n) into fmt from (select type, count(*) n from public.sessions where event_id = e.id and type in ('practice','qualifying','race') group by type) t;
  if fmt ? 'race' then
    update public.series set weekend_format = fmt where id = e.series_id and weekend_format is null;
  end if;
  lead := e.start_date - new.created_at::date;
  insert into public.series_sources (series_id, tt_url, tt_lead_days) values (e.series_id, nullif(new.evidence->>'url', ''), greatest(lead, 0))
  on conflict (series_id) do update set
    tt_url = coalesce(nullif(new.evidence->>'url', ''), public.series_sources.tt_url),
    tt_lead_days = least(30, greatest(coalesce(public.series_sources.tt_lead_days, 0), greatest(lead, 0)));
  return null;
end $$;
drop trigger if exists learn_after_timetable on public.proposals;
create trigger learn_after_timetable after update of status on public.proposals
  for each row when (new.status = 'approved' and old.status = 'pending' and new.kind = 'timetable')
  execute function private.learn_timetable();

-- the search rules, now with "complete", "followed" and the learned start
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
      and private.event_followed(e.id)
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
      and private.event_followed(e.id)
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

-- how many athletes follow each championship (for the admin's Championships page)
create or replace function public.series_followers()
returns table(series_id uuid, published int, total int)
language sql stable security definer set search_path to '' as $$
  select en.series_id, count(distinct en.profile_id) filter (where p.published)::int, count(distinct en.profile_id)::int
  from public.entries en join public.profiles p on p.id = en.profile_id
  where en.year >= extract(year from current_date)::int and private.is_admin()
  group by en.series_id
$$;
grant execute on function public.series_followers() to authenticated;

-- learn the formats of the timetables already approved (the most common one per championship)
update public.series s set weekend_format = f.fmt
from (
  select distinct on (series_id) series_id, fmt from (
    select e.series_id, t.fmt, count(*) n
    from public.events e
    join lateral (select jsonb_object_agg(type, n) fmt from (select type, count(*) n from public.sessions x where x.event_id = e.id and type in ('practice','qualifying','race') group by type) q) t on true
    where t.fmt ? 'race'
    group by e.series_id, t.fmt
  ) c order by series_id, n desc
) f
where s.id = f.series_id and s.weekend_format is null;

-- complete = every kind of session the championship usually has (practice / qualifying / race) is there at least once:
-- tolerant of sprint weekends and double headers, but a timetable with only practice published keeps being searched
create or replace function private.tt_complete(p_event uuid) returns boolean
language sql stable security definer set search_path to '' as $$
  with c as (select type, count(*) n from public.sessions where event_id = p_event group by type),
  f as (select s.weekend_format fmt from public.events e join public.series s on s.id = e.series_id where e.id = p_event)
  select exists (select 1 from c where type = 'race')
     and not exists (select 1 from jsonb_each_text(coalesce((select fmt from f), '{}'::jsonb)) k
                     where k.value::int > 0 and not exists (select 1 from c where c.type = k.key))
$$;
