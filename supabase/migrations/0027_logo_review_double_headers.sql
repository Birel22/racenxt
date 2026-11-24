-- Logos go through the Review queue like everything else (Reject / Adjust / Approve),
-- keep the cut-out original so the colour can be changed later, and double-header weekends
-- (one weekend = two championship rounds, e.g. Formula E) keep both round numbers.

alter table public.series add column if not exists logo_src_url text;
alter table public.series add column if not exists logo_mode text not null default 'original'
  check (logo_mode in ('original', 'white', 'black'));
alter table public.events add column if not exists round_to int;

alter table public.proposals drop constraint if exists proposals_kind_check;
alter table public.proposals add constraint proposals_kind_check check (kind = any (array[
  'new_event', 'event_change', 'event_cancelled', 'timetable', 'watch_link', 'new_season', 'series_links', 'logo']));

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
      updated_at = now()
    where id = pr.event_id;
  elsif pr.kind = 'event_cancelled' then
    delete from public.events where id = pr.event_id;
  elsif pr.kind in ('new_event', 'new_season') then
    select slug into sl from public.series where id = pr.series_id;
    for e in select * from jsonb_array_elements(case when jsonb_typeof(pl->'events') = 'array' then pl->'events' else jsonb_build_array(pl) end) loop
      k := coalesce(e->>'ext_key', sl || '-' || coalesce(e->>'year', left(e->>'start_date', 4)) || coalesce('-r' || (e->>'round'), '-' || regexp_replace(lower(e->>'name'), '[^a-z0-9]+', '-', 'g')));
      insert into public.events (series_id, ext_key, year, round, round_to, venue_id, name, start_date, end_date, duration_label, watch_url, note)
      values (pr.series_id, k, coalesce((e->>'year')::int, left(e->>'start_date', 4)::int), (e->>'round')::int, (e->>'round_to')::int,
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

-- Formula E 2027: the double headers the calendar agent found (round = first race of the weekend)
update public.events e set round_to = e.round + 1
from public.series s
where s.id = e.series_id and s.slug = 'fe' and e.year = 2027 and e.end_date > e.start_date and e.round_to is null
  and not exists (select 1 from public.events x where x.series_id = e.series_id and x.year = e.year and x.round = e.round + 1);

-- the admin's race list also shows the last round of a double header
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
    e.round_to
   FROM public.events e
     LEFT JOIN public.venues v ON v.id = e.venue_id
     LEFT JOIN public.series s ON s.id = e.series_id
     LEFT JOIN LATERAL (SELECT count(*) AS n, bool_or(sessions.type = 'race'::text) AS has_race FROM public.sessions WHERE sessions.event_id = e.id) sc ON true
     LEFT JOIN LATERAL (SELECT check_runs.ran_at, check_runs.result FROM public.check_runs WHERE check_runs.event_id = e.id ORDER BY check_runs.ran_at DESC LIMIT 1) lr ON true;
