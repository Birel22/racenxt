-- "Is this race's timetable complete?" decides whether the schedule agent keeps checking it.
-- With classes, it's judged class by class, and only for the classes that published athletes race in:
-- a KZ2 timetable that's out is enough for a KZ2 athlete, even if OK Junior's isn't published yet.
-- A class counts as complete when it has a race session (its own, or one for everyone) and the agent didn't say that
-- class's timetable is still partial (answer.complete = false without that class in answer.complete_classes).
-- Championships without classes, or whose athletes haven't picked a class: as before (the whole weekend).
create or replace function private.tt_complete(p_event uuid)
returns boolean language plpgsql stable security definer set search_path to '' as $$
declare ev record; ans jsonb; fol text[]; c text; partial boolean;
begin
  select e.id, e.series_id, e.year, s.classes, s.class_format into ev
  from public.events e left join public.series s on s.id = e.series_id where e.id = p_event;
  select r.trace->'answer' into ans from public.check_runs r
  where r.event_id = p_event and r.result in ('proposal', 'no_change') order by r.ran_at desc limit 1;
  partial := coalesce(ans->>'complete' = 'false' and ans->>'timetable_found' = 'true', false);

  if ev.series_id is not null and coalesce(ev.class_format, 'none') <> 'none' and coalesce(array_length(ev.classes, 1), 0) > 1 then
    select array_agg(distinct m.c) into fol
    from public.entries en
    join public.profiles p on p.id = en.profile_id and p.published
    cross join lateral (select x as c from unnest(ev.classes) x
                        where upper(regexp_replace(x, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(coalesce(en.category, ''), '[^A-Za-z0-9]', '', 'g'))) m
    where en.series_id = ev.series_id and en.year = ev.year;
    if fol is not null then
      foreach c in array fol loop
        if not exists (select 1 from public.sessions where event_id = p_event and type = 'race' and (classes is null or c = any(classes))) then return false; end if;
        if partial and not exists (select 1 from jsonb_array_elements_text(coalesce(ans->'complete_classes', '[]'::jsonb)) x
                                   where upper(regexp_replace(x, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(c, '[^A-Za-z0-9]', '', 'g'))) then return false; end if;
      end loop;
      return true;
    end if;
  end if;

  return exists (select 1 from public.sessions where event_id = p_event and type = 'race') and not partial;
end $$;
