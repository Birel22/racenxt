-- Agent runs: running state, a human summary and token usage
alter table public.check_runs drop constraint if exists check_runs_result_check;
alter table public.check_runs add constraint check_runs_result_check check (result in ('running','no_change','proposal','error','skipped_unchanged'));
alter table public.check_runs drop constraint if exists check_runs_kind_check;
alter table public.check_runs add constraint check_runs_kind_check check (kind in ('monthly','weekly','daily','final','manual','discover'));
alter table public.check_runs add column if not exists summary text;
alter table public.check_runs add column if not exists usage jsonb;
alter table public.check_runs add column if not exists finished_at timestamptz;

-- Find or create a circuit from what the agent found (time zone validated)
create or replace function private.venue_for(c jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare vid uuid; tz text;
begin
  if c is null or coalesce(c->>'name', '') = '' then return null; end if;
  select id into vid from public.venues where lower(name) = lower(c->>'name') limit 1;
  if vid is not null then return vid; end if;
  tz := c->>'timezone';
  if tz is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = tz) then return null; end if;
  insert into public.venues (name, city, country, country_code, lat, lng, timezone)
  values (c->>'name', c->>'city', coalesce(c->>'country', ''), nullif(upper(c->>'country_code'), ''),
          (c->>'lat')::double precision, (c->>'lng')::double precision, tz)
  returning id into vid;
  return vid;
end $$;

create or replace function public.apply_proposal(p_id uuid, p_payload jsonb default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare pr public.proposals; pl jsonb; sl text;
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
    insert into public.events (series_id, ext_key, year, round, venue_id, name, start_date, end_date, duration_label, note)
    select pr.series_id,
           coalesce(e->>'ext_key', sl || '-' || left(e->>'start_date', 4) || coalesce('-r' || (e->>'round'), '-' || regexp_replace(lower(e->>'name'), '[^a-z0-9]+', '-', 'g'))),
           coalesce((e->>'year')::int, left(e->>'start_date', 4)::int), (e->>'round')::int,
           coalesce((e->>'venue_id')::uuid, private.venue_for(e->'circuit')), e->>'name',
           (e->>'start_date')::date, coalesce((e->>'end_date')::date, (e->>'start_date')::date), e->>'duration_label', e->>'note'
    from jsonb_array_elements(case when jsonb_typeof(pl->'events') = 'array' then pl->'events' else jsonb_build_array(pl) end) e
    on conflict (ext_key) do nothing;
  end if;
  update public.proposals set status = 'approved', payload = pl, reviewer = (select auth.uid()), reviewed_at = now() where id = p_id;
end $$;
revoke execute on function public.apply_proposal(uuid, jsonb) from public, anon;
grant execute on function public.apply_proposal(uuid, jsonb) to authenticated;
