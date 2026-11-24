-- One car, one circuit: the same rule as championships (0034), for the vehicle library and circuits.
--
-- Circuits: private.venue_key() drops accents, punctuation and generic words (circuit, autodromo, international, raceway...):
--   "Circuito de Jerez – Ángel Nieto" = "Circuito de Jerez Angel Nieto" -> jerezangelnieto · "Autódromo Internacional do Algarve" = "Algarve International Circuit" -> algarve
-- Two circuits are the same when their keys are equal (and, if both have coordinates, they're within 25 km), or when one key
-- contains the other and they're within 3 km ("Red Bull Ring" / "Red Bull Ring - Spielberg", "Circuit Zandvoort" / "MASCOT Zandvoort Circuit").
-- private.venue_for() (used when the agents' races are approved) and public.venue_match() (used by the admin and athletes' pages) reuse
-- the existing circuit instead of creating a new one; a trigger refuses a new circuit that's the same as one already there.
--
-- Cars: private.vehicle_key() -> lowercase letters and digits only, LMGT3 = GT3 ("ORECA 07" = "Oreca-07"). Two library cars
-- (approved) can't have the same key. An athlete's own car (not in the library) is never blocked. apply_cars links to a library car with the same key.

create or replace function private.venue_key(t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select coalesce(string_agg(w, '' order by n), '')
  from regexp_split_to_table(
         regexp_replace(translate(lower(coalesce(t, '')), 'àáâãäåāăąçćčďèéêëēęěìíîïīłñńňòóôõöøōőřśšşťùúûüūůűýÿžźżß', 'aaaaaaaaacccdeeeeeeeiiiiilnnnoooooooorsssstuuuuuuuyyzzzs'), '[^a-z0-9]+', ' ', 'g'),
         '\s+') with ordinality as x(w, n)
  where w <> '' and w not in ('circuit','circuits','circuito','circuitos','autodromo','autodrom','international','internacional','internazionale','internationale',
                              'nazionale','national','raceway','speedway','motorsport','track','karting','world','the','de','do','di','del','della','la','le','les',
                              'of','des','du','el','da','e','y','and','et')
$$;

-- km between two points (good enough at circuit scale)
create or replace function private.km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision) returns double precision
language sql immutable parallel safe set search_path = '' as $$
  select sqrt(power((lat2 - lat1) * 110.57, 2) + power((lng2 - lng1) * 111.32 * cos(radians((lat1 + lat2) / 2)), 2))
$$;

-- the circuit already there that this one is the same as (null if none)
create or replace function private.venue_same(p_name text, p_lat double precision, p_lng double precision, p_self uuid default null) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare k text := private.venue_key(p_name); hit uuid;
begin
  if length(k) < 3 then return null; end if;
  select v.id into hit from public.venues v
  where v.id is distinct from p_self
    and (
      (private.venue_key(v.name) = k and (p_lat is null or v.lat is null or private.km(p_lat, p_lng, v.lat, v.lng) < 25))
      or (p_lat is not null and v.lat is not null and private.km(p_lat, p_lng, v.lat, v.lng) < 3
          and length(private.venue_key(v.name)) >= 3
          and (strpos(private.venue_key(v.name), k) > 0 or strpos(k, private.venue_key(v.name)) > 0))
    )
  order by (private.venue_key(v.name) = k) desc, (v.lat is not null) desc, v.created_at
  limit 1;
  return hit;
end $$;

create or replace function public.venue_match(p_name text, p_lat double precision default null, p_lng double precision default null)
returns uuid language sql stable security definer set search_path = '' as $$ select private.venue_same(p_name, p_lat, p_lng, null) $$;
grant execute on function public.venue_match(text, double precision, double precision) to authenticated;

create or replace function private.venues_unique() returns trigger language plpgsql set search_path = '' as $$
declare hit uuid; hn text;
begin
  hit := private.venue_same(new.name, new.lat, new.lng, new.id);
  if hit is not null then
    select name into hn from public.venues where id = hit;
    raise exception 'This circuit is already in Racenxt: %', hn using errcode = '23505';
  end if;
  return new;
end $$;
drop trigger if exists venues_unique on public.venues;
create trigger venues_unique before insert or update of name, lat, lng on public.venues
  for each row execute function private.venues_unique();

-- races the agents found: reuse the circuit already there
create or replace function private.venue_for(c jsonb) returns uuid
language plpgsql security definer set search_path to '' as $function$
declare vid uuid; tz text;
begin
  if c is null or coalesce(c->>'name', '') = '' then return null; end if;
  vid := private.venue_same(c->>'name', (c->>'lat')::double precision, (c->>'lng')::double precision, null);
  if vid is not null then return vid; end if;
  tz := c->>'timezone';
  if tz is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = tz) then return null; end if;
  insert into public.venues (name, city, country, country_code, lat, lng, timezone)
  values (c->>'name', c->>'city', coalesce(c->>'country', ''), nullif(upper(c->>'country_code'), ''),
          (c->>'lat')::double precision, (c->>'lng')::double precision, tz)
  returning id into vid;
  return vid;
end $function$;

-- ---------- cars ----------
create or replace function private.vehicle_key(t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select replace(regexp_replace(translate(lower(coalesce(t, '')), 'àáâãäåāăąçćčďèéêëēęěìíîïīłñńňòóôõöøōőřśšşťùúûüūůűýÿžźżß', 'aaaaaaaaacccdeeeeeeeiiiiilnnnoooooooorsssstuuuuuuuyyzzzs'), '[^a-z0-9]', '', 'g'), 'lmgt3', 'gt3')
$$;

create or replace function private.vehicles_unique() returns trigger language plpgsql set search_path = '' as $$
declare hn text;
begin
  if new.status <> 'approved' then return new; end if;   -- an athlete's own car is never blocked
  select name into hn from public.vehicles
  where id <> new.id and status = 'approved' and private.vehicle_key(name) = private.vehicle_key(new.name) limit 1;
  if hn is not null then raise exception 'This car is already in the library: %', hn using errcode = '23505'; end if;
  return new;
end $$;
drop trigger if exists vehicles_unique on public.vehicles;
create trigger vehicles_unique before insert or update of name, status on public.vehicles
  for each row execute function private.vehicles_unique();

-- the cars agent's approved list: link to a library car with the same key instead of adding it again
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
      select id into vid from public.vehicles where status = 'approved' and private.vehicle_key(name) = private.vehicle_key(c->>'name') limit 1;
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
