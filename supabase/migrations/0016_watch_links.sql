-- Where to watch: the official stream and the list of all broadcasters belong to the championship;
-- events.watch_url is only a broadcast page made for that one race (found in race week).
alter table public.series add column if not exists stream_url text, add column if not exists broadcasters_url text;
update public.series set stream_url = watch_url where stream_url is null and watch_url ~* '(f1tv|videopass|plus\.fiawec|youtube\.com|live\.asianlemansseries)';
update public.series s set broadcasters_url = x.u from (
  select distinct on (e.series_id) e.series_id, e.watch_url u from public.events e where e.watch_url ~* 'broadcast' order by e.series_id) x
  where x.series_id = s.id and s.broadcasters_url is null;
update public.series s set stream_url = x.u from (
  select distinct on (e.series_id) e.series_id, rtrim(e.watch_url, '/') u from public.events e where e.watch_url ~* '(f1tv|videopass|plus\.fiawec)' order by e.series_id) x
  where x.series_id = s.id and s.stream_url is null;
-- the per-race links found so far were all the championship's general ones
update public.events set watch_url = null where watch_url ~* '(f1tv\.formula1\.com/?$|motogp\.com/en/videopass|plus\.fiawec\.com/?$|f1-broadcast-information)';

alter table public.proposals drop constraint if exists proposals_kind_check;
alter table public.proposals add constraint proposals_kind_check check (kind in ('new_event','event_change','event_cancelled','timetable','watch_link','new_season','series_links'));

create or replace view public.event_overview with (security_invoker = true) as
 SELECT e.id, e.series_id, e.owner_profile_id, e.ext_key, e.year, e.round, e.venue_id, e.name, e.start_date, e.end_date,
    e.duration_label, e.watch_url, e.note, e.created_at, e.updated_at,
    v.name AS venue_name, v.city AS venue_city, v.country AS venue_country, v.timezone,
    COALESCE(sc.n, 0::bigint) AS session_count, COALESCE(sc.has_race, false) AS has_race,
    CASE WHEN e.watch_url IS NOT NULL THEN 'race'
         WHEN s.stream_url IS NOT NULL OR s.broadcasters_url IS NOT NULL THEN 'championship'
         ELSE 'missing' END AS watch_status,
    lr.ran_at AS last_check_at, lr.result AS last_check_result,
    (SELECT count(*) FROM public.proposals p WHERE p.event_id = e.id AND p.status = 'pending') AS pending_proposals
   FROM public.events e
     LEFT JOIN public.venues v ON v.id = e.venue_id
     LEFT JOIN public.series s ON s.id = e.series_id
     LEFT JOIN LATERAL (SELECT count(*) AS n, bool_or(sessions.type = 'race') AS has_race FROM public.sessions WHERE sessions.event_id = e.id) sc ON true
     LEFT JOIN LATERAL (SELECT check_runs.ran_at, check_runs.result FROM public.check_runs WHERE check_runs.event_id = e.id ORDER BY check_runs.ran_at DESC LIMIT 1) lr ON true;

create or replace view public.series_overview with (security_invoker = true) as
 SELECT s.id, s.slug, s.name, s.short_name, s.sport, s.logo_url, s.website_url, s.watch_url, s.created_at,
    (SELECT count(*) FROM public.events e WHERE e.series_id = s.id AND e.year = EXTRACT(year FROM CURRENT_DATE)::integer) AS races_this_year,
    (SELECT count(*) FROM public.events e WHERE e.series_id = s.id AND e.year = EXTRACT(year FROM CURRENT_DATE)::integer + 1) AS races_next_year,
    nx.name AS next_race_name, nx.start_date AS next_race_date, nx.id AS next_race_id,
    (SELECT count(*) FROM public.events e WHERE e.series_id = s.id AND e.end_date >= CURRENT_DATE AND e.start_date <= CURRENT_DATE + 7
       AND (NOT EXISTS (SELECT 1 FROM public.sessions x WHERE x.event_id = e.id)
            OR (e.watch_url IS NULL AND s.stream_url IS NULL AND s.broadcasters_url IS NULL))) AS missing_soon,
    (SELECT count(*) FROM public.proposals p WHERE p.series_id = s.id AND p.status = 'pending') AS pending_proposals,
    lr.ran_at AS last_check_at, lr.result AS last_check_result,
    (SELECT count(*) FROM public.entries en WHERE en.series_id = s.id) AS user_entries,
    s.stream_url, s.broadcasters_url
   FROM public.series s
     LEFT JOIN LATERAL (SELECT e.id, e.name, e.start_date FROM public.events e WHERE e.series_id = s.id AND e.end_date >= CURRENT_DATE ORDER BY e.start_date LIMIT 1) nx ON true
     LEFT JOIN LATERAL (SELECT r.ran_at, r.result FROM public.check_runs r WHERE r.series_id = s.id ORDER BY r.ran_at DESC LIMIT 1) lr ON true;

create or replace function public.apply_proposal(p_id uuid, p_payload jsonb default null)
returns void language plpgsql security definer set search_path = '' as $function$
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
    update public.events set watch_url = nullif(pl->>'watch_url', ''), updated_at = now() where id = pr.event_id;
  elsif pr.kind = 'series_links' then
    update public.series set
      stream_url = case when pl ? 'stream_url' then nullif(pl->>'stream_url', '') else stream_url end,
      broadcasters_url = case when pl ? 'broadcasters_url' then nullif(pl->>'broadcasters_url', '') else broadcasters_url end
    where id = pr.series_id;
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
end $function$;
