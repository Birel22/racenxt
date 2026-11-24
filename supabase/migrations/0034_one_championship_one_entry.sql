-- One championship, one entry.
-- private.series_key() turns a name into a comparison key, the same rule as seriesKey() in docs/admin.html (keep both in step):
--   "FIA Formula 3" / "Formula 3" / "F3" -> f3 · "Moto GP" / "MotoGP" -> motogp · "Formula One" -> f1
--   "FIA World Endurance Championship" / "World Endurance Championship" -> worldendurance
-- A new or renamed championship is refused when its name or short name gives the same key as another one's name or short name.
-- (The admin page also warns about look-alikes, e.g. initials, and asks before going on: that softer check lives only in the page.)

create or replace function private.series_key(t text) returns text
language plpgsql immutable parallel safe set search_path = '' as $$
declare
  w text[]; out text := ''; i int := 1; cur text; nx text;
begin
  t := lower(coalesce(t, ''));
  t := translate(t, 'àáâãäåāăąçćčďèéêëēęěìíîïīłñńňòóôõöøōőřśšşťùúûüūůűýÿžźżß', 'aaaaaaaaacccdeeeeeeeiiiiilnnnoooooooorsssstuuuuuuuyyzzzs');
  t := replace(t, '&', ' and ');
  select coalesce(array_agg(x order by n), '{}') into w
    from regexp_split_to_table(t, '[^a-z0-9]+') with ordinality as r(x, n)
    where x <> '' and x not in ('the','of','fia','fim','cik','championship','championships','championnat','campionato','campeonato','meisterschaft');
  while i <= coalesce(array_length(w, 1), 0) loop
    cur := w[i]; nx := w[i + 1];
    if cur = 'formula' and nx is not null and (nx in ('one','two','three','four','five') or (nx ~ '^[0-9a-z]{1,2}$' and nx <> 'and')) then
      out := out || 'f' || case nx when 'one' then '1' when 'two' then '2' when 'three' then '3' when 'four' then '4' when 'five' then '5' else nx end;
      i := i + 2;
    else
      out := out || cur;
      i := i + 1;
    end if;
  end loop;
  return out;
end $$;

-- fires after series_short_name (alphabetical order), so an empty short name has already been filled in
create or replace function private.series_unique() returns trigger language plpgsql set search_path = '' as $$
declare k_name text := private.series_key(new.name); k_short text := private.series_key(new.short_name); hit record;
begin
  select s.name, s.short_name into hit from public.series s
   where s.id <> new.id
     and (private.series_key(s.name) in (k_name, k_short) or private.series_key(s.short_name) in (k_name, k_short))
   limit 1;
  if found then
    raise exception 'This championship is already in Racenxt: % (%)', hit.name, hit.short_name using errcode = '23505';
  end if;
  return new;
end $$;
drop trigger if exists series_unique on public.series;
create trigger series_unique before insert or update of name, short_name on public.series
  for each row execute function private.series_unique();

-- hard stop even if two people add the same name at the very same moment
create unique index if not exists series_same_key on public.series (private.series_key(name));
