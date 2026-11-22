-- Fast overviews for the admin (built for hundreds of championships)

create or replace view public.event_overview with (security_invoker = true) as
select e.*,
       v.name as venue_name, v.city as venue_city, v.country as venue_country, v.timezone,
       coalesce(sc.n, 0) as session_count,
       coalesce(sc.has_race, false) as has_race,
       case when e.watch_url is not null then 'specific'
            when s.watch_url is not null then 'default'
            else 'missing' end as watch_status,
       lr.ran_at as last_check_at, lr.result as last_check_result,
       (select count(*) from public.proposals p where p.event_id = e.id and p.status = 'pending') as pending_proposals
from public.events e
left join public.venues v on v.id = e.venue_id
left join public.series s on s.id = e.series_id
left join lateral (
  select count(*) as n, bool_or(type = 'race') as has_race from public.sessions where event_id = e.id
) sc on true
left join lateral (
  select ran_at, result from public.check_runs where event_id = e.id order by ran_at desc limit 1
) lr on true;

create or replace view public.series_overview with (security_invoker = true) as
select s.*,
       (select count(*) from public.events e where e.series_id = s.id and e.year = extract(year from current_date)::int) as races_this_year,
       (select count(*) from public.events e where e.series_id = s.id and e.year = extract(year from current_date)::int + 1) as races_next_year,
       nx.name as next_race_name, nx.start_date as next_race_date, nx.id as next_race_id,
       (select count(*) from public.events e
          where e.series_id = s.id and e.end_date >= current_date and e.start_date <= current_date + 7
            and not exists (select 1 from public.sessions x where x.event_id = e.id)) as missing_soon,
       (select count(*) from public.proposals p where p.series_id = s.id and p.status = 'pending') as pending_proposals,
       lr.ran_at as last_check_at, lr.result as last_check_result,
       (select count(*) from public.entries en where en.series_id = s.id) as user_entries
from public.series s
left join lateral (
  select id, name, start_date from public.events e where e.series_id = s.id and e.end_date >= current_date order by start_date limit 1
) nx on true
left join lateral (
  select ran_at, result from public.check_runs r where r.series_id = s.id order by ran_at desc limit 1
) lr on true;

-- Users list for admins: each page with its owner's and editors' emails
create or replace function public.admin_users()
returns table (profile_id uuid, slug text, display_name text, published boolean, created_at timestamptz,
               subscription_status text, plan text, members jsonb)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.slug, p.display_name, p.published, p.created_at, s.status, s.plan,
         coalesce((select jsonb_agg(jsonb_build_object('email', u.email, 'role', m.role) order by m.role desc)
                   from public.profile_members m join auth.users u on u.id = m.user_id where m.profile_id = p.id), '[]'::jsonb)
  from public.profiles p
  left join public.subscriptions s on s.profile_id = p.id
  where private.is_admin()
  order by p.display_name;
$$;
revoke execute on function public.admin_users() from public, anon;
grant execute on function public.admin_users() to authenticated;

-- Signed-in accounts without any page yet (admins only)
create or replace function public.admin_accounts()
returns table (user_id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, pages int, is_admin boolean)
language sql stable security definer set search_path = ''
as $$
  select u.id, u.email::text, u.created_at, u.last_sign_in_at,
         (select count(*)::int from public.profile_members m where m.user_id = u.id),
         exists (select 1 from public.admins a where a.user_id = u.id)
  from auth.users u
  where private.is_admin()
  order by u.created_at desc;
$$;
revoke execute on function public.admin_accounts() from public, anon;
grant execute on function public.admin_accounts() to authenticated;

create index if not exists check_runs_event_time_idx on public.check_runs (event_id, ran_at desc);
create index if not exists events_series_end_idx on public.events (series_id, end_date);
