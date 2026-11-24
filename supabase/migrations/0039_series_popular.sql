-- Sign-up "Your championships": the most picked championships come first (numbers only, no names).
create or replace function public.series_popular()
returns table(series_id uuid, athletes int)
language sql stable security definer set search_path to '' as $$
  select en.series_id, count(distinct en.profile_id)::int
  from public.entries en join public.profiles p on p.id = en.profile_id and p.published
  where en.year >= extract(year from current_date)::int - 1
  group by en.series_id
$$;
grant execute on function public.series_popular() to anon, authenticated;
