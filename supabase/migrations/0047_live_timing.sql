-- Live timing (decided 25 Nov 2026): found by the where-to-watch agent, like the official stream.
-- series.timing_url: the championship's official live timing, the same address all season.
-- events.timing_url: only for a race with a live timing page of its own (e.g. Le Mans), found in race week.
alter table public.series add column if not exists timing_url text;
alter table public.events add column if not exists timing_url text;

create or replace function public.apply_proposal(p_id uuid, p_payload jsonb default null)
 returns void language plpgsql security definer set search_path to ''
as $function$
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
    -- a race's own broadcast page and/or its own live timing page: only what the proposal carries changes
    update public.events set
      watch_url = case when pl ? 'watch_url' then nullif(pl->>'watch_url', '') else watch_url end,
      timing_url = case when pl ? 'timing_url' then nullif(pl->>'timing_url', '') else timing_url end,
      updated_at = now()
    where id = pr.event_id;
  elsif pr.kind = 'series_links' then
    update public.series set
      stream_url = case when pl ? 'stream_url' then nullif(pl->>'stream_url', '') else stream_url end,
      broadcasters_url = case when pl ? 'broadcasters_url' then nullif(pl->>'broadcasters_url', '') else broadcasters_url end,
      timing_url = case when pl ? 'timing_url' then nullif(pl->>'timing_url', '') else timing_url end
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
