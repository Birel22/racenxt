-- "Is this race's timetable complete?" with classes: every class of the championship must be complete
-- (a race session of its own or one for everyone, and not reported as still partial).
-- Checking only the classes published athletes race in would cost less: kept in BACKLOG.md for later.
create or replace function private.tt_complete(p_event uuid)
returns boolean language plpgsql stable security definer set search_path to '' as $$
declare ev record; ans jsonb; c text; partial boolean;
begin
  select e.id, e.series_id, s.classes, s.class_format into ev
  from public.events e left join public.series s on s.id = e.series_id where e.id = p_event;
  select r.trace->'answer' into ans from public.check_runs r
  where r.event_id = p_event and r.result in ('proposal', 'no_change') order by r.ran_at desc limit 1;
  partial := coalesce(ans->>'complete' = 'false' and ans->>'timetable_found' = 'true', false);

  if ev.series_id is not null and coalesce(ev.class_format, 'none') <> 'none' and coalesce(array_length(ev.classes, 1), 0) > 1 then
    foreach c in array ev.classes loop
      if not exists (select 1 from public.sessions where event_id = p_event and type = 'race' and (classes is null or c = any(classes))) then return false; end if;
      if partial and not exists (select 1 from jsonb_array_elements_text(coalesce(ans->'complete_classes', '[]'::jsonb)) x
                                 where upper(regexp_replace(x, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(c, '[^A-Za-z0-9]', '', 'g'))) then return false; end if;
    end loop;
    return true;
  end if;

  return exists (select 1 from public.sessions where event_id = p_event and type = 'race') and not partial;
end $$;
