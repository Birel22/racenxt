-- Disciplines (Sportscars, Formula, Motorbikes, …): editable list with icons, replaces the fixed sport check
create table if not exists public.disciplines (
  key text primary key check (key ~ '^[a-z0-9-]{2,40}$'),
  name text not null,
  icon_svg text not null,
  sort int not null default 100,
  created_at timestamptz not null default now()
);
alter table public.disciplines enable row level security;
create policy disciplines_read on public.disciplines for select to anon, authenticated using (true);
create policy disciplines_admin on public.disciplines for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
insert into public.disciplines (key, name, icon_svg, sort) values
('sportscars','Sportscars',$svg$<svg class="sp-ic" viewBox="-0.6 0.1 23.4 6.8" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-linecap="round"><path stroke-width="0.95" d="M0.3 5.1 L0.8 3.7 Q1.3 2.9 2.6 2.6 Q4.2 2.2 5.6 2.4 L6.7 2.5 L8.7 0.95 Q9.1 0.75 9.8 0.75 L11.4 0.75 Q12.6 0.8 13.6 1.5 L15.6 2.3 Q16.6 2.4 17.6 2.4 L21.9 2.8 L21.9 5.1 L20.5 5.1 A2.05 2.05 0 0 0 16.4 5.1 L7.3 5.1 A2.05 2.05 0 0 0 3.2 5.1 Z"/><path stroke-width="0.7" d="M11.6 0.8 L20.4 1.05 M20.2 1.05 L22.3 0.95 M21.9 1 L21.9 2.8"/><circle stroke-width="0.95" cx="5.25" cy="5.15" r="1.4"/><circle stroke-width="0.95" cx="18.45" cy="5.15" r="1.4"/></svg>$svg$,0),
('formula','Formula',$svg$<svg class="sp-ic" viewBox="-0.6 0.1 23.6 7.3" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-linecap="round"><path stroke-width="0.95" d="M0.2 5.4 L2.6 5.4 M2.4 4.6 L6.4 4 L8.8 3.5 L10 2.9 L12.6 2.5 Q15.4 2.3 17.2 3.1 L19.8 4 L19.8 5.1"/><path stroke-width="0.95" d="M6.2 5.3 L16.4 5.3"/><path stroke-width="0.8" d="M9.7 3.1 Q10.8 1.7 12.4 2.5"/><path stroke-width="0.8" d="M19.9 1.2 L22.6 1.2 M22.3 1.2 L22.3 4.7 M20.8 1.2 L21.1 4"/><circle stroke-width="0.95" cx="4.4" cy="5" r="1.65"/><circle stroke-width="0.95" cx="18.1" cy="5" r="1.65"/></svg>$svg$,10),
('motorbikes','Motorbikes',$svg$<svg class="sp-ic" viewBox="-0.4 -0.2 14 8.2" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-linecap="round"><circle stroke-width="0.85" cx="2.5" cy="5.2" r="2"/><circle stroke-width="0.85" cx="11" cy="5.2" r="2"/><path stroke-width="0.85" d="M2.5 5.2 L4.3 1.4 M3.6 1.4 L5.2 1.4"/><path stroke-width="0.85" d="M4.6 2.3 Q6 1.4 7.6 1.8 L9.2 2.1 L11.6 1.3 M4.9 3.6 L8.6 3.3 L11 5.2 M6 5.2 L8.6 3.3"/></svg>$svg$,20)
on conflict (key) do nothing;
alter table public.series drop constraint if exists series_sport_check;
alter table public.series add constraint series_sport_fk foreign key (sport) references public.disciplines(key) on update cascade;
create index if not exists series_sport_idx on public.series (sport);

-- Logo candidates found by the agent; the admin page picks the right one with AI and makes it white
alter table public.series add column if not exists logo_candidates jsonb;

-- "initial": every race of the current and next season gets one timetable search after it's added
-- (far-away races usually answer "not published yet"; race-week checks pick them up later).
-- Has its own pace (per_tick) and doesn't use the daily cap of the recurring checks.
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
  ),
  regular as (
    select d.* from (select * from ev union all select * from se) d, cfg, used
    where used.n < cfg.cap
  ),
  initial as (
    select 'initial' as kind, e.series_id, e.id as event_id, s.short_name || ' ' || e.name as label, e.start_date as sort1, 2 as sort2
    from public.events e join public.series s on s.id = e.series_id
    where e.end_date >= current_date and e.year <= extract(year from current_date)::int + 1
      and not exists (select 1 from public.sessions x where x.event_id = e.id)
      and not exists (select 1 from public.check_runs r where r.event_id = e.id)
      and not exists (select 1 from public.proposals p where p.event_id = e.id and p.status = 'pending')
  )
  select d.kind, d.series_id, d.event_id, d.label
  from (select * from regular union all select * from initial) d, cfg
  where cfg.enabled
  order by d.sort2, d.sort1
  limit greatest(0, p_limit);
$$;
revoke all on function public.due_checks(int) from public, anon, authenticated;
grant execute on function public.due_checks(int) to service_role;
