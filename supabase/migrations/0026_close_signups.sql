-- New athlete pages can be switched off (app_settings.new_pages = {"open": false}). Admins can still add pages.
insert into public.app_settings (key, value, updated_at) values ('new_pages', '{"open": false}'::jsonb, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();

create or replace function public.new_pages_open() returns boolean
language sql stable security definer set search_path to '' as $$
  select coalesce((select (value->>'open')::boolean from public.app_settings where key = 'new_pages'), true)
$$;
grant execute on function public.new_pages_open() to anon, authenticated;

create or replace function public.create_profile(p_slug text, p_display_name text, p_first_name text default null, p_sport text default 'motorsport')
returns uuid language plpgsql security definer set search_path to '' as $function$
declare new_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'not signed in'; end if;
  if not public.new_pages_open() and not private.is_admin() then raise exception 'New pages are closed for now'; end if;
  if not public.slug_available(p_slug) then raise exception 'This page link is taken or not allowed'; end if;
  insert into public.profiles (slug, display_name, first_name, sport)
  values (lower(p_slug), p_display_name, p_first_name, p_sport) returning id into new_id;
  insert into public.profile_members (profile_id, user_id, role) values (new_id, (select auth.uid()), 'owner');
  insert into public.subscriptions (profile_id) values (new_id);
  return new_id;
end $function$;
