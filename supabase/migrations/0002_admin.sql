-- Admins can manage athlete profiles (manual onboarding during validation)
create policy profiles_admin on public.profiles for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy entries_admin on public.entries for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy sponsors_admin on public.sponsors for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy overrides_admin on public.event_overrides for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy subscriptions_admin on public.subscriptions for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy members_admin on public.profile_members for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

-- Approve a proposal: applies it to official data in one transaction (admins only)
-- payload shapes (local venue times only):
--   timetable:      {"sessions":[{"type":"race","label":"Race","local_start":"2027-06-12 16:00","duration_min":1440}]}
--   watch_link:     {"watch_url":"https://..."}
--   event_change:   {"name":..,"start_date":..,"end_date":..,"duration_label":..,"note":..}
--   event_cancelled:{}
--   new_event:      {"ext_key":"elms-2027-r6","year":2027,"round":6,"venue_id":"..","name":"..","start_date":"..","end_date":"..","duration_label":".."}
create or replace function public.apply_proposal(p_id uuid, p_payload jsonb default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare pr public.proposals; pl jsonb;
begin
  if not private.is_admin() then raise exception 'admins only'; end if;
  select * into pr from public.proposals where id = p_id for update;
  if pr.id is null or pr.status <> 'pending' then raise exception 'proposal not pending'; end if;
  pl := coalesce(p_payload, pr.payload);
  if pr.kind = 'timetable' then
    delete from public.sessions where event_id = pr.event_id;
    insert into public.sessions (event_id, type, label, local_start, duration_min, category)
    select pr.event_id, s->>'type', s->>'label', (s->>'local_start')::timestamp, coalesce((s->>'duration_min')::int, 60), s->>'category'
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
      venue_id = coalesce((pl->>'venue_id')::uuid, venue_id),
      note = coalesce(pl->>'note', note),
      updated_at = now()
    where id = pr.event_id;
  elsif pr.kind = 'event_cancelled' then
    delete from public.events where id = pr.event_id;
  elsif pr.kind in ('new_event', 'new_season') then
    insert into public.events (series_id, ext_key, year, round, venue_id, name, start_date, end_date, duration_label, note)
    select pr.series_id, e->>'ext_key', (e->>'year')::int, (e->>'round')::int, (e->>'venue_id')::uuid, e->>'name',
           (e->>'start_date')::date, (e->>'end_date')::date, e->>'duration_label', e->>'note'
    from jsonb_array_elements(case when jsonb_typeof(pl->'events') = 'array' then pl->'events' else jsonb_build_array(pl) end) e
    on conflict (ext_key) do nothing;
  end if;
  update public.proposals set status = 'approved', payload = pl, reviewer = (select auth.uid()), reviewed_at = now() where id = p_id;
end $$;
revoke execute on function public.apply_proposal(uuid, jsonb) from public, anon;
grant execute on function public.apply_proposal(uuid, jsonb) to authenticated;

-- Reject: the reason is appended to that championship's agent instructions
create or replace function public.reject_proposal(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare pr public.proposals;
begin
  if not private.is_admin() then raise exception 'admins only'; end if;
  update public.proposals set status = 'rejected', reason = p_reason, reviewer = (select auth.uid()), reviewed_at = now()
  where id = p_id and status = 'pending' returning * into pr;
  if pr.id is null then raise exception 'proposal not pending'; end if;
  if pr.series_id is not null and coalesce(p_reason, '') <> '' then
    insert into public.series_sources (series_id, agent_instructions) values (pr.series_id, '- ' || p_reason)
    on conflict (series_id) do update set agent_instructions = public.series_sources.agent_instructions || E'\n- ' || p_reason;
  end if;
end $$;
revoke execute on function public.reject_proposal(uuid, text) from public, anon;
grant execute on function public.reject_proposal(uuid, text) to authenticated;

-- Who am I (lets the admin page show whether the signed-in user is an admin)
create or replace function public.am_i_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select private.is_admin() $$;
revoke execute on function public.am_i_admin() from public, anon;
grant execute on function public.am_i_admin() to authenticated;
