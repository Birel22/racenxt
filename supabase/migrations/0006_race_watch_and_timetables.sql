-- One where-to-watch link per race (found by the AI in race week). The championship link is only a hint for the AI.
-- New seasons can carry timetables already published, created together with the races.

create or replace view public.event_overview with (security_invoker = true) as
select e.*,
       v.name as venue_name, v.city as venue_city, v.country as venue_country, v.timezone,
       coalesce(sc.n, 0) as session_count,
       coalesce(sc.has_race, false) as has_race,
       case when e.watch_url is not null then 'specific' else 'missing' end as watch_status,
       lr.ran_at as last_check_at, lr.result as last_check_result,
       (select count(*) from public.proposals p where p.event_id = e.id and p.status = 'pending') as pending_proposals
from public.events e
left join public.venues v on v.id = e.venue_id
left join public.series s on s.id = e.series_id
left join lateral (
  select count(*) as n, bool_or(type = 'race') as has_race from public.sessions where event_id = e.id
) sc on true
left join lateral (
  select ran_at, result from public.check_runs where event_id = e.id order by ran_at desc limit 1
) lr on true;

create or replace view public.series_overview with (security_invoker = true) as
select s.*,
       (select count(*) from public.events e where e.series_id = s.id and e.year = extract(year from current_date)::int) as races_this_year,
       (select count(*) from public.events e where e.series_id = s.id and e.year = extract(year from current_date)::int + 1) as races_next_year,
       nx.name as next_race_name, nx.start_date as next_race_date, nx.id as next_race_id,
       (select count(*) from public.events e
          where e.series_id = s.id and e.end_date >= current_date and e.start_date <= current_date + 7
            and (e.watch_url is null or not exists (select 1 from public.sessions x where x.event_id = e.id))) as missing_soon,
       (select count(*) from public.proposals p where p.series_id = s.id and p.status = 'pending') as pending_proposals,
       lr.ran_at as last_check_at, lr.result as last_check_result,
       (select count(*) from public.entries en where en.series_id = s.id) as user_entries
from public.series s
left join lateral (
  select id, name, start_date from public.events e where e.series_id = s.id and e.end_date >= current_date order by start_date limit 1
) nx on true
left join lateral (
  select ran_at, result from public.check_runs r where r.series_id = s.id order by ran_at desc limit 1
) lr on true;

create or replace function public.apply_proposal(p_id uuid, p_payload jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
declare pr public.proposals; pl jsonb; sl text; e jsonb; eid uuid; k text;
begin
  if not private.is_admin() then raise exception 'admins only'; end if;
  select * into pr from public.proposals where id = p_id for update;
  if pr.id is null or pr.status <> 'pending' then raise exception 'proposal not pending'; end if;
  pl := coalesce(p_payload, pr.payload);
  if pr.kind = 'timetable' then
    delete from public.sessions where event_id = pr.event_id;
    insert into public.sessions (event_id, type, label, local_start, duration_min, category)
    select pr.event_id, coalesce(s->>'type', 'other'), s->>'label', (s->>'local_start')::timestamp, coalesce((s->>'duration_min')::int, 60), s->>'category'
    from jsonb_array_elements(pl->'sessions') s;
  elsif pr.kind = 'watch_link' then
    if pr.event_id is not null then update public.events set watch_url = pl->>'watch_url', updated_at = now() where id = pr.event_id;
    else update public.series set watch_url = pl->>'watch_url' where id = pr.series_id; end if;
  elsif pr.kind = 'event_change' then
    update public.events set
      name = coalesce(pl->>'name', name),
      start_date = coalesce((pl->>'start_date')::date, start_date),
      end_date = coalesce((pl->>'end_date')::date, end_date),
      duration_label = coalesce(pl->>'duration_label', duration_label),
      venue_id = coalesce((pl->>'venue_id')::uuid, private.venue_for(pl->'circuit'), venue_id),
      note = coalesce(pl->>'note', note),
      updated_at = now()
    where id = pr.event_id;
  elsif pr.kind = 'event_cancelled' then
    delete from public.events where id = pr.event_id;
  elsif pr.kind in ('new_event', 'new_season') then
    select slug into sl from public.series where id = pr.series_id;
    for e in select * from jsonb_array_elements(case when jsonb_typeof(pl->'events') = 'array' then pl->'events' else jsonb_build_array(pl) end) loop
      k := coalesce(e->>'ext_key', sl || '-' || coalesce(e->>'year', left(e->>'start_date', 4)) || coalesce('-r' || (e->>'round'), '-' || regexp_replace(lower(e->>'name'), '[^a-z0-9]+', '-', 'g')));
      insert into public.events (series_id, ext_key, year, round, venue_id, name, start_date, end_date, duration_label, watch_url, note)
      values (pr.series_id, k, coalesce((e->>'year')::int, left(e->>'start_date', 4)::int), (e->>'round')::int,
              coalesce((e->>'venue_id')::uuid, private.venue_for(e->'circuit')), e->>'name',
              (e->>'start_date')::date, coalesce((e->>'end_date')::date, (e->>'start_date')::date), e->>'duration_label', e->>'watch_url', e->>'note')
      on conflict (ext_key) do nothing
      returning id into eid;
      if eid is not null and jsonb_typeof(e->'sessions') = 'array' then
        insert into public.sessions (event_id, type, label, local_start, duration_min, category)
        select eid, coalesce(s->>'type', 'other'), s->>'label', (s->>'local_start')::timestamp, coalesce((s->>'duration_min')::int, 60), s->>'category'
        from jsonb_array_elements(e->'sessions') s;
      end if;
    end loop;
  end if;
  update public.proposals set status = 'approved', payload = pl, reviewer = (select auth.uid()), reviewed_at = now() where id = p_id;
end $$;
