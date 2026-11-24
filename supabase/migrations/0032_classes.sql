-- Shared calendars (e.g. IMSA): a championship can have several classes, and not every class races at every round.
-- series.classes = the classes (null = one class); events.classes = the classes racing that weekend (null = all of them).
-- The athlete's class is entries.category: their page and calendar feeds only show the races of their class.

alter table public.series add column if not exists classes text[];
alter table public.events add column if not exists classes text[];

-- a JSON list of names as text[], null when empty
create or replace function private.jtext(j jsonb) returns text[] language sql immutable set search_path to '' as $$
  select case when jsonb_typeof(j) = 'array' and jsonb_array_length(j) > 0
    then array(select btrim(x) from jsonb_array_elements_text(j) x where btrim(x) <> '') end
$$;

alter table public.proposals drop constraint if exists proposals_kind_check;
alter table public.proposals add constraint proposals_kind_check check (kind = any (array[
  'new_event', 'event_change', 'event_cancelled', 'timetable', 'watch_link', 'new_season', 'series_links', 'logo', 'classes']));

create or replace function public.apply_proposal(p_id uuid, p_payload jsonb default null)
returns void language plpgsql security definer set search_path to '' as $function$
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
  elsif pr.kind = 'logo' then
    if coalesce(pl->>'logo_url', '') = '' then raise exception 'no logo to apply'; end if;
    update public.series set
      logo_url = pl->>'logo_url',
      logo_src_url = nullif(pl->>'logo_src_url', ''),
      logo_mode = coalesce(nullif(pl->>'logo_mode', ''), 'original'),
      logo_candidates = null
    where id = pr.series_id;
  elsif pr.kind = 'event_change' then
    update public.events set
      name = coalesce(pl->>'name', name),
      start_date = coalesce((pl->>'start_date')::date, start_date),
      end_date = coalesce((pl->>'end_date')::date, end_date),
      duration_label = coalesce(pl->>'duration_label', duration_label),
      round = coalesce((pl->>'round')::int, round),
      round_to = case when pl ? 'round_to' then (pl->>'round_to')::int else round_to end,
      venue_id = coalesce((pl->>'venue_id')::uuid, private.venue_for(pl->'circuit'), venue_id),
      note = coalesce(pl->>'note', note),
      classes = case when pl ? 'classes' then private.jtext(pl->'classes') else classes end,
      updated_at = now()
    where id = pr.event_id;
  elsif pr.kind = 'classes' then
    update public.series set classes = private.jtext(pl->'classes') where id = pr.series_id;
    for e in select * from jsonb_array_elements(coalesce(pl->'events', '[]'::jsonb)) loop
      update public.events set classes = private.jtext(e->'classes'), updated_at = now()
      where id = (e->>'event_id')::uuid and series_id = pr.series_id;
    end loop;
  elsif pr.kind = 'event_cancelled' then
    delete from public.events where id = pr.event_id;
  elsif pr.kind in ('new_event', 'new_season') then
    select slug into sl from public.series where id = pr.series_id;
    if private.jtext(pl->'classes') is not null then
      update public.series set classes = private.jtext(pl->'classes') where id = pr.series_id and classes is null;
    end if;
    for e in select * from jsonb_array_elements(case when jsonb_typeof(pl->'events') = 'array' then pl->'events' else jsonb_build_array(pl) end) loop
      k := coalesce(e->>'ext_key', sl || '-' || coalesce(e->>'year', left(e->>'start_date', 4)) || coalesce('-r' || (e->>'round'), '-' || regexp_replace(lower(e->>'name'), '[^a-z0-9]+', '-', 'g')));
      insert into public.events (series_id, ext_key, year, round, round_to, venue_id, name, start_date, end_date, duration_label, watch_url, note, classes)
      values (pr.series_id, k, coalesce((e->>'year')::int, left(e->>'start_date', 4)::int), (e->>'round')::int, (e->>'round_to')::int,
              coalesce((e->>'venue_id')::uuid, private.venue_for(e->'circuit')), e->>'name',
              (e->>'start_date')::date, coalesce((e->>'end_date')::date, (e->>'start_date')::date), e->>'duration_label', e->>'watch_url', e->>'note', private.jtext(e->'classes'))
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

create or replace view public.event_overview with (security_invoker = true) as
 SELECT e.id, e.series_id, e.owner_profile_id, e.ext_key, e.year, e.round, e.venue_id, e.name, e.start_date, e.end_date,
    e.duration_label, e.watch_url, e.note, e.created_at, e.updated_at,
    v.name AS venue_name, v.city AS venue_city, v.country AS venue_country, v.timezone,
    COALESCE(sc.n, 0::bigint) AS session_count, COALESCE(sc.has_race, false) AS has_race,
    CASE WHEN e.watch_url IS NOT NULL THEN 'race'::text
         WHEN s.stream_url IS NOT NULL OR s.broadcasters_url IS NOT NULL THEN 'championship'::text
         ELSE 'missing'::text END AS watch_status,
    lr.ran_at AS last_check_at, lr.result AS last_check_result,
    (SELECT count(*) FROM public.proposals p WHERE p.event_id = e.id AND p.status = 'pending'::text) AS pending_proposals,
    e.round_to,
    e.classes
   FROM public.events e
     LEFT JOIN public.venues v ON v.id = e.venue_id
     LEFT JOIN public.series s ON s.id = e.series_id
     LEFT JOIN LATERAL (SELECT count(*) AS n, bool_or(sessions.type = 'race'::text) AS has_race FROM public.sessions WHERE sessions.event_id = e.id) sc ON true
     LEFT JOIN LATERAL (SELECT check_runs.ran_at, check_runs.result FROM public.check_runs WHERE check_runs.event_id = e.id ORDER BY check_runs.ran_at DESC LIMIT 1) lr ON true;
