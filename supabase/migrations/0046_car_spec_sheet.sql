-- The car spec sheet (decided 25 Nov 2026): every figure is stored as a number in a fixed unit, and the text fans see
-- (engine, power, gearbox, weight, dimensions) is written from those numbers by the database, so every car reads the same.
-- Later, US units are one more formatter, not new data.
--   name, manufacturer, kind, engine, power, drivetrain, weight, length × width × height: required
--   hybrid: only when the car has one · gearbox: important, not required · wheelbase: optional, sought
--   bop: one note at the bottom of the car's specs ("Power and weight subject to Balance of Performance")
-- Category and max rpm are no longer used (the columns stay, unused, so nothing is lost).

alter table public.vehicles
  add column if not exists engine_maker text,                       -- only when someone other than the manufacturer builds the engine, e.g. "Gibson GK428"
  add column if not exists engine_cc int check (engine_cc between 20 and 20000),
  add column if not exists engine_layout text,                      -- V8, V6, inline-4, flat-6, single-cylinder…
  add column if not exists engine_aspiration text check (engine_aspiration in ('naturally aspirated', 'turbo', 'twin-turbo', 'supercharged')),
  add column if not exists power_hp int check (power_hp between 1 and 5000),   -- one number; combined (engine + electric) for hybrids
  add column if not exists gears int check (gears between 1 and 12),
  add column if not exists gearbox_detail text,                     -- "sequential, paddle-shift (Xtrac)"; "direct drive" for a kart with no gearbox
  add column if not exists weight_kg int check (weight_kg between 20 and 5000),   -- one number, the lightest (dry / minimum)
  add column if not exists length_mm int check (length_mm between 500 and 10000),
  add column if not exists width_mm int check (width_mm between 300 and 5000),
  add column if not exists height_mm int check (height_mm between 300 and 5000),
  add column if not exists wheelbase_mm int check (wheelbase_mm between 300 and 8000),
  add column if not exists bop boolean not null default false,
  add column if not exists spec_sources jsonb,                      -- {"power_hp": "https://…", "weight_kg": "https://…"}: where each figure comes from
  add column if not exists specs_attempts int not null default 0;  -- the agent tries up to 3 times, a week apart, while a required figure is missing

-- kW always follows hp (1 hp = 0.7457 kW), so the two never disagree
alter table public.vehicles add column if not exists power_kw int generated always as (round(power_hp * 0.7457)::int) stored;

-- write the fans' text from the numbers (a car with no numbers yet, e.g. an athlete's own car typed by hand, keeps its text)
create or replace function private.vehicle_spec_text() returns trigger language plpgsql as $$
declare n text;
begin
  if new.engine_cc is not null or new.engine_layout is not null or new.engine_aspiration is not null then
    new.engine := nullif(concat_ws(' ', nullif(btrim(new.engine_maker), ''),
      case when new.engine_cc >= 1000 then to_char(round(new.engine_cc / 1000.0, 1), 'FM990.0') || ' L'
           when new.engine_cc is not null then new.engine_cc || ' cc' end,
      nullif(btrim(new.engine_layout), ''), new.engine_aspiration), '');
  end if;
  if new.power_hp is not null then
    new.power := to_char(new.power_hp, 'FM9,999') || ' hp (' || to_char(round(new.power_hp * 0.7457), 'FM9,999') || ' kW)';
  end if;
  if new.gears is not null or nullif(btrim(new.gearbox_detail), '') is not null then
    new.gearbox := concat_ws(' ', case when new.gears is not null then new.gears || '-speed' end, nullif(btrim(new.gearbox_detail), ''));
  end if;
  if new.weight_kg is not null then
    new.weight := to_char(new.weight_kg, 'FM9,999') || ' kg';
  end if;
  if new.length_mm is not null and new.width_mm is not null and new.height_mm is not null then
    n := to_char(new.length_mm, 'FM99,999') || ' × ' || to_char(new.width_mm, 'FM99,999') || ' × ' || to_char(new.height_mm, 'FM99,999') || ' mm';
    if new.wheelbase_mm is not null then n := n || ', wheelbase ' || to_char(new.wheelbase_mm, 'FM99,999') || ' mm'; end if;
    new.dimensions := n;
  end if;
  return new;
end $$;
drop trigger if exists vehicles_spec_text on public.vehicles;
create trigger vehicles_spec_text before insert or update on public.vehicles
  for each row execute function private.vehicle_spec_text();

-- Which library cars still need the agent: a required figure missing, nothing waiting for review, fewer than 3 tries,
-- the last one more than a week ago. Kart chassis are skipped (a chassis brand has no single engine or spec sheet).
create or replace function private.vehicle_needs_specs(v public.vehicles) returns boolean language sql stable as $$
  select (v.status = 'approved' or v.suggested)
     and v.specs_pending is null
     and coalesce(v.category, '') <> 'kart chassis'
     and v.specs_attempts < 3
     and (v.specs_tried_at is null or v.specs_tried_at < now() - interval '7 days')
     and (v.engine_cc is null or v.engine_layout is null or v.engine_aspiration is null or v.power_hp is null or v.drivetrain is null
          or v.weight_kg is null or v.length_mm is null or v.width_mm is null or v.height_mm is null or v.kind is null)
$$;

-- for the agent (service role only): the next cars to look up, newest first
create or replace function public.cars_needing_specs(p_limit int default 3)
returns setof public.vehicles language sql stable security definer set search_path = '' as $$
  select * from public.vehicles v where private.vehicle_needs_specs(v) order by v.specs_tried_at nulls first, v.created_at desc limit greatest(1, least(p_limit, 10))
$$;
revoke execute on function public.cars_needing_specs(int) from public, anon, authenticated;
grant execute on function public.cars_needing_specs(int) to service_role;

-- start the agent right away when cars that need specs arrive or join the library (retries come from the 15-minute tick)
create or replace function private.specs_kick() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from nt where private.vehicle_needs_specs(nt)) then
    perform net.http_post(
      url := 'https://cfpbrfqdtgwpxthehpgz.supabase.co/functions/v1/agent',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from public.agent_secrets where key = 'cron')),
      body := '{"action":"specs"}'::jsonb,
      timeout_milliseconds := 20000);
  end if;
  return null;
end $$;
create or replace function private.specs_kick_row() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.vehicle_needs_specs(new) then
    perform net.http_post(
      url := 'https://cfpbrfqdtgwpxthehpgz.supabase.co/functions/v1/agent',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from public.agent_secrets where key = 'cron')),
      body := '{"action":"specs"}'::jsonb,
      timeout_milliseconds := 20000);
  end if;
  return null;
end $$;

-- every library car is looked up again under the new sheet (the old free-text specs stay on fans' pages until approved)
update public.vehicles set specs_tried_at = null, specs_attempts = 0 where engine_cc is null;
