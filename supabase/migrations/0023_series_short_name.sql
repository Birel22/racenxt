-- The short name is shown where a championship has no logo: keep it short (max 12 characters).
-- Too long or empty -> initials of the name's words, without what's in brackets ("European Endurance Prototype Cup" -> "EEPC").
create or replace function private.series_short_name() returns trigger language plpgsql set search_path = '' as $$
declare base text; ini text;
begin
  if new.short_name is null or btrim(new.short_name) = '' or length(btrim(new.short_name)) > 12 then
    base := btrim(regexp_replace(coalesce(new.name, ''), '\([^)]*\)', '', 'g'));
    select string_agg(left(w, 1), '') into ini
      from regexp_split_to_table(base, '\s+') as w
      where w ~ '^[[:upper:][:digit:]]';
    new.short_name := left(upper(coalesce(nullif(ini, ''), base)), 12);
  else
    new.short_name := btrim(new.short_name);
  end if;
  return new;
end $$;
drop trigger if exists series_short_name on public.series;
create trigger series_short_name before insert or update of short_name, name on public.series
  for each row execute function private.series_short_name();
