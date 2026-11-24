-- Classes everywhere: every session can belong to one or more classes of its championship.
--   sessions.classes = the classes the session is for (null = everyone)
--   series.class_format = 'none' (one class) · 'shared' (classes share practice and races, some sessions split, e.g. WEC/ELMS/IMSA qualifying)
--                         · 'separate' (each class has its own practice, qualifying and races under one championship name, e.g. karting KZ / OK / OKJ)
-- An athlete's page and calendar files show the sessions of their class plus the sessions for everyone.
-- The agents write a session's class in sessions.category (one name, or several separated by commas); the trigger below turns it into
-- sessions.classes using the championship's official class names, so a name the championship doesn't have never hides a session.

alter table public.series add column if not exists class_format text not null default 'none'
  check (class_format in ('none', 'shared', 'separate'));
update public.series set class_format = 'shared' where class_format = 'none' and coalesce(array_length(classes, 1), 0) > 1;

alter table public.sessions add column if not exists classes text[];

-- "KZ2" -> {KZ2} · "LMP2, LMP3" -> {LMP2,LMP3} · "LMP2 Pro/Am" stays whole when that's a class · unknown name -> null (shown to everyone)
create or replace function private.session_classes(p_series uuid, p_category text) returns text[]
language plpgsql stable set search_path to '' as $$
declare cls text[]; parts text[]; out text[] := '{}'; p text; hit text;
begin
  if p_category is null or btrim(p_category) = '' then return null; end if;
  select classes into cls from public.series where id = p_series;
  if coalesce(array_length(cls, 1), 0) = 0 then return null; end if;
  select c into hit from unnest(cls) c where upper(regexp_replace(c, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(p_category, '[^A-Za-z0-9]', '', 'g')) limit 1;
  if hit is not null then return array[hit]; end if;
  parts := regexp_split_to_array(p_category, '\s*(,|/|&|\+|;|\s and\s|\s et\s)\s*');
  foreach p in array parts loop
    continue when btrim(p) = '';
    hit := null;
    select c into hit from unnest(cls) c where upper(regexp_replace(c, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(p, '[^A-Za-z0-9]', '', 'g')) limit 1;
    if hit is null then return null; end if;
    if not hit = any(out) then out := out || hit; end if;
  end loop;
  return nullif(out, '{}');
end $$;

create or replace function private.sessions_tag_class() returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.classes is null or (tg_op = 'UPDATE' and new.category is distinct from old.category) then
    new.classes := private.session_classes((select series_id from public.events where id = new.event_id), new.category);
  end if;
  return new;
end $$;
drop trigger if exists sessions_tag_class on public.sessions;
create trigger sessions_tag_class before insert or update of category, classes on public.sessions
  for each row execute function private.sessions_tag_class();

-- when a championship's classes change, its sessions are tagged again
create or replace function private.series_retag_sessions() returns trigger language plpgsql security definer set search_path to '' as $$
begin
  update public.sessions s set classes = private.session_classes(new.id, s.category)
  from public.events e where e.id = s.event_id and e.series_id = new.id and s.category is not null;
  return null;
end $$;
drop trigger if exists series_retag_sessions on public.series;
create trigger series_retag_sessions after update of classes on public.series
  for each row when (old.classes is distinct from new.classes) execute function private.series_retag_sessions();

-- tag what's already there
update public.sessions s set classes = private.session_classes(e.series_id, s.category)
from public.events e where e.id = s.event_id and s.category is not null;

-- the fan page and calendar files read session_times: add the classes (new column at the end)
create or replace view public.session_times with (security_invoker = true) as
 select s.id, s.event_id, s.type, s.label, s.local_start, s.duration_min, s.category, s.created_at, v.timezone,
    (s.local_start at time zone v.timezone) as start_utc,
    (s.local_start at time zone v.timezone) + make_interval(mins => s.duration_min) as end_utc,
    s.classes
   from public.sessions s
     join public.events e on e.id = s.event_id
     join public.venues v on v.id = e.venue_id;

-- the class structure agent's suggestion: classes + whether they share sessions
alter table public.proposals drop constraint if exists proposals_kind_check;
alter table public.proposals add constraint proposals_kind_check check (kind = any (array[
  'new_event', 'event_change', 'event_cancelled', 'timetable', 'watch_link', 'new_season', 'series_links', 'logo', 'classes', 'cars', 'class_format']));
alter table public.check_runs drop constraint if exists check_runs_kind_check;
alter table public.check_runs add constraint check_runs_kind_check check (kind = any (array[
  'monthly', 'weekly', 'daily', 'final', 'manual', 'discover', 'initial', 'icon', 'classes', 'cars', 'class_format']));

create or replace function public.apply_class_format(p_id uuid, p_payload jsonb default null)
returns void language plpgsql security definer set search_path to '' as $function$
declare pr public.proposals; pl jsonb; f text;
begin
  if not private.is_admin() then raise exception 'admins only'; end if;
  select * into pr from public.proposals where id = p_id for update;
  if pr.id is null or pr.status <> 'pending' or pr.kind <> 'class_format' then raise exception 'proposal not pending'; end if;
  pl := coalesce(p_payload, pr.payload);
  f := coalesce(nullif(pl->>'class_format', ''), 'none');
  if f not in ('none', 'shared', 'separate') then raise exception 'unknown class format'; end if;
  update public.series set
    class_format = f,
    classes = case when f = 'none' then null else coalesce(private.jtext(pl->'classes'), classes) end
  where id = pr.series_id;
  update public.proposals set status = 'approved', payload = pl, reviewer = (select auth.uid()), reviewed_at = now() where id = p_id;
end $function$;
revoke execute on function public.apply_class_format(uuid, jsonb) from public, anon;
grant execute on function public.apply_class_format(uuid, jsonb) to authenticated;
