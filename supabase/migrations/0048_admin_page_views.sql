-- Page views per page for the admin's Users & pages list: last 7 days, last 30 days and all time
-- (counted by track_view, once per visit of a fan page)
create or replace function public.admin_page_views()
returns table (profile_id uuid, last_7 bigint, last_30 bigint, total bigint)
language sql stable security definer set search_path = '' as $$
  select v.profile_id,
         coalesce(sum(v.count) filter (where v.day > current_date - 7), 0),
         coalesce(sum(v.count) filter (where v.day > current_date - 30), 0),
         coalesce(sum(v.count), 0)
  from public.page_views_daily v
  where private.is_admin()
  group by v.profile_id
$$;
revoke execute on function public.admin_page_views() from public, anon;
grant execute on function public.admin_page_views() to authenticated;
