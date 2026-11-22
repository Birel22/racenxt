-- Vehicles: a fixed set of spec fields (the admin library is the source for every user page)
alter table public.vehicles
  add column if not exists engine text,
  add column if not exists hybrid text,
  add column if not exists power text,
  add column if not exists drivetrain text check (drivetrain in ('awd', 'rwd', 'fwd')),
  add column if not exists max_rpm text,
  add column if not exists gearbox text,
  add column if not exists weight text,
  add column if not exists dimensions text;

-- carry over what the old free-form list held
update public.vehicles v set
  engine     = coalesce(engine,     (select x->>'value' from jsonb_array_elements(v.specs) x where x->>'label' ilike 'engine%' limit 1)),
  hybrid     = coalesce(hybrid,     (select x->>'value' from jsonb_array_elements(v.specs) x where x->>'label' ilike 'hybrid%' limit 1)),
  power      = coalesce(power,      (select x->>'value' from jsonb_array_elements(v.specs) x where x->>'label' ilike 'power%' limit 1)),
  max_rpm    = coalesce(max_rpm,    (select x->>'value' from jsonb_array_elements(v.specs) x where x->>'label' ~* '^(max rpm|redline|rev)' limit 1)),
  gearbox    = coalesce(gearbox,    (select x->>'value' from jsonb_array_elements(v.specs) x where x->>'label' ilike 'gearbox%' limit 1)),
  weight     = coalesce(weight,     (select x->>'value' from jsonb_array_elements(v.specs) x where x->>'label' ~* 'weight' limit 1)),
  dimensions = coalesce(dimensions, (select x->>'value' from jsonb_array_elements(v.specs) x where x->>'label' ~* '^(dimensions|length)' limit 1)),
  drivetrain = coalesce(drivetrain, (select case when x->>'value' ~* 'rear|rwd' then 'rwd' when x->>'value' ~* 'front|fwd' then 'fwd'
                                                 when x->>'value' ~* 'all|four|4wd|awd' then 'awd' end
                                     from jsonb_array_elements(v.specs) x where x->>'label' ilike 'drive%' limit 1));

-- Users: is a page link free? (unpublished pages are hidden by RLS, so ask the server)
create or replace function public.slug_available(p_slug text)
returns boolean language sql stable security definer set search_path = '' as $$
  select lower(p_slug) ~ '^[a-z0-9-]{2,40}$'
     and lower(p_slug) not in ('admin', 'app', 'index', 'fan', 'login', 'signup', 'settings', 'api', 'help', 'about', 'pricing', 'terms', 'privacy', 'racenxt', 'www', 'support')
     and not exists (select 1 from public.profiles where slug = lower(p_slug));
$$;
grant execute on function public.slug_available(text) to anon, authenticated;

-- create_profile: refuse reserved / taken links with a clear message
create or replace function public.create_profile(p_slug text, p_display_name text, p_first_name text default null, p_sport text default 'motorsport')
returns uuid language plpgsql security definer set search_path = ''
as $$
declare new_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'not signed in'; end if;
  if not public.slug_available(p_slug) then raise exception 'This page link is taken or not allowed'; end if;
  insert into public.profiles (slug, display_name, first_name, sport)
  values (lower(p_slug), p_display_name, p_first_name, p_sport) returning id into new_id;
  insert into public.profile_members (profile_id, user_id, role) values (new_id, (select auth.uid()), 'owner');
  insert into public.subscriptions (profile_id) values (new_id);
  return new_id;
end $$;
revoke execute on function public.create_profile(text, text, text, text) from public, anon;
grant execute on function public.create_profile(text, text, text, text) to authenticated;

-- Admins can read every user's entries (for support), even unpublished
create policy entries_admin_read on public.entries for select to authenticated using ((select private.is_admin()));
