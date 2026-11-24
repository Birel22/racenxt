-- One car, several class names: a Ferrari 296 GT3 Evo is "GT3", "GTD", "GTD Pro", "LMGT3"...
-- vehicles.classes holds every class name the car races under (one car in the library, not one per class).
-- Kept up to date by itself: the car's own category, and every class it is listed under in a championship.
alter table public.vehicles add column if not exists classes text[] not null default '{}';

-- merge: keep the existing names, add new ones, no duplicates (same text, case ignored)
create or replace function private.class_merge(a text[], b text[])
returns text[] language sql immutable as $$
  select coalesce(array_agg(x order by ord), '{}') from (
    select distinct on (lower(btrim(x))) btrim(x) x, ord
    from unnest(coalesce(a, '{}') || coalesce(b, '{}')) with ordinality t(x, ord)
    where nullif(btrim(x), '') is not null
    order by lower(btrim(x)), ord
  ) s
$$;

-- backfill: category + the classes from series_vehicles
update public.vehicles v set classes = private.class_merge(
  private.class_merge(v.classes, case when v.category is not null and v.category <> 'kart chassis' then array[v.category] else '{}' end),
  (select coalesce(array_agg(c), '{}') from public.series_vehicles sv, unnest(sv.classes) c where sv.vehicle_id = v.id));

-- a car's category is also one of its classes (not the "kart chassis" type label)
create or replace function private.vehicle_classes_cat()
returns trigger language plpgsql as $$
begin
  if new.category is not null and new.category <> 'kart chassis' then
    new.classes := private.class_merge(new.classes, array[new.category]);
  else
    new.classes := private.class_merge(new.classes, '{}');
  end if;
  return new;
end $$;
drop trigger if exists vehicles_classes_cat on public.vehicles;
create trigger vehicles_classes_cat before insert or update of category, classes on public.vehicles
  for each row execute function private.vehicle_classes_cat();

-- listed in a championship under some classes: the car learns those names
create or replace function private.series_vehicle_classes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(array_length(new.classes, 1), 0) > 0 then
    update public.vehicles set classes = private.class_merge(classes, new.classes)
    where id = new.vehicle_id and not (private.class_merge(classes, new.classes) = classes);
  end if;
  return new;
end $$;
drop trigger if exists series_vehicles_classes on public.series_vehicles;
create trigger series_vehicles_classes after insert or update of classes on public.series_vehicles
  for each row execute function private.series_vehicle_classes();
