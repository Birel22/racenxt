-- Cars agent (agent 6): when a championship is added, it reads the official entry list and finds the cars that race in it.
-- Its findings go to the Review queue as one "cars" proposal; approving it adds the new cars to the library (with their specs)
-- and links every car to the championship (series_vehicles), so athletes picking that championship can be offered its cars.

alter table public.proposals drop constraint if exists proposals_kind_check;
alter table public.proposals add constraint proposals_kind_check check (kind = any (array[
  'new_event', 'event_change', 'event_cancelled', 'timetable', 'watch_link', 'new_season', 'series_links', 'logo', 'classes', 'cars']));

alter table public.check_runs drop constraint if exists check_runs_kind_check;
alter table public.check_runs add constraint check_runs_kind_check check (kind = any (array[
  'monthly', 'weekly', 'daily', 'final', 'manual', 'discover', 'initial', 'icon', 'classes', 'cars']));

-- where the specs of a library car come from (shown in the admin, never to fans)
alter table public.vehicles add column if not exists spec_source text;

-- which cars race in which championship (and in which classes)
create table if not exists public.series_vehicles (
  series_id uuid not null references public.series (id) on delete cascade,
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  classes text[],
  season int,
  created_at timestamptz not null default now(),
  primary key (series_id, vehicle_id)
);
create index if not exists series_vehicles_vehicle_idx on public.series_vehicles (vehicle_id);
alter table public.series_vehicles enable row level security;
drop policy if exists series_vehicles_read on public.series_vehicles;
create policy series_vehicles_read on public.series_vehicles for select to anon, authenticated using (true);
drop policy if exists series_vehicles_admin on public.series_vehicles;
create policy series_vehicles_admin on public.series_vehicles for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- Approve a "cars" proposal. payload.cars: [{name, manufacturer, category, classes, vehicle_id?, keep?, engine, hybrid, power,
-- drivetrain, max_rpm, gearbox, weight, dimensions, spec_url}]. A car with keep = false is skipped.
-- A car that matches a library car (vehicle_id, or the same name) is only linked; a new one is added to the library, approved.
create or replace function public.apply_cars(p_id uuid, p_payload jsonb default null)
returns int language plpgsql security definer set search_path to '' as $function$
declare pr public.proposals; pl jsonb; c jsonb; vid uuid; n int := 0; dt text;
begin
  if not private.is_admin() then raise exception 'admins only'; end if;
  select * into pr from public.proposals where id = p_id for update;
  if pr.id is null or pr.status <> 'pending' or pr.kind <> 'cars' then raise exception 'proposal not pending'; end if;
  pl := coalesce(p_payload, pr.payload);
  for c in select * from jsonb_array_elements(coalesce(pl->'cars', '[]'::jsonb)) loop
    continue when coalesce((c->>'keep')::boolean, true) = false or nullif(btrim(c->>'name'), '') is null;
    vid := nullif(c->>'vehicle_id', '')::uuid;
    if vid is not null and not exists (select 1 from public.vehicles where id = vid) then vid := null; end if;
    if vid is null then
      select id into vid from public.vehicles where lower(btrim(name)) = lower(btrim(c->>'name')) limit 1;
    end if;
    if vid is null then
      dt := lower(nullif(c->>'drivetrain', ''));
      insert into public.vehicles (name, manufacturer, category, specs, status, engine, hybrid, power, drivetrain, max_rpm, gearbox, weight, dimensions, spec_source)
      values (btrim(c->>'name'), nullif(c->>'manufacturer', ''), nullif(c->>'category', ''), '[]'::jsonb, 'approved',
              nullif(c->>'engine', ''), nullif(c->>'hybrid', ''), nullif(c->>'power', ''),
              case when dt in ('awd', 'rwd', 'fwd') then dt end,
              nullif(c->>'max_rpm', ''), nullif(c->>'gearbox', ''), nullif(c->>'weight', ''), nullif(c->>'dimensions', ''), nullif(c->>'spec_url', ''))
      returning id into vid;
    end if;
    insert into public.series_vehicles (series_id, vehicle_id, classes, season)
    values (pr.series_id, vid, private.jtext(c->'classes'), nullif(pl->>'season', '')::int)
    on conflict (series_id, vehicle_id) do update set classes = coalesce(excluded.classes, series_vehicles.classes), season = coalesce(excluded.season, series_vehicles.season);
    n := n + 1;
  end loop;
  update public.proposals set status = 'approved', payload = pl, reviewer = (select auth.uid()), reviewed_at = now() where id = p_id;
  return n;
end $function$;
revoke execute on function public.apply_cars(uuid, jsonb) from public, anon;
grant execute on function public.apply_cars(uuid, jsonb) to authenticated;
