-- Deleting a page also deletes its owner's account when that account has no other page (no "accounts without a page" left behind);
-- an account without a page can be deleted on its own; admins are never deleted.
-- Test pages: an admin can try the sign-up as many times as they like; each new try deletes their previous test pages.
alter table public.profiles add column if not exists is_test boolean not null default false;

create or replace function public.admin_delete_page(p_profile uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare owners uuid[]; n int := 0; u uuid;
begin
  if not private.is_admin() then raise exception 'admins only'; end if;
  select coalesce(array_agg(user_id), '{}') into owners from public.profile_members where profile_id = p_profile;
  delete from public.profiles where id = p_profile;
  foreach u in array owners loop
    if not exists (select 1 from public.profile_members where user_id = u) and not exists (select 1 from public.admins where user_id = u) then
      update public.proposals set reviewer = null where reviewer = u;
      delete from auth.users where id = u; n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.admin_delete_page(uuid) from public, anon;
grant execute on function public.admin_delete_page(uuid) to authenticated;

create or replace function public.admin_delete_account(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'admins only'; end if;
  if exists (select 1 from public.admins where user_id = p_user) then raise exception 'an admin account can''t be deleted here'; end if;
  if exists (select 1 from public.profile_members where user_id = p_user) then raise exception 'this account still has a page: delete the page first'; end if;
  update public.proposals set reviewer = null where reviewer = p_user;
  delete from auth.users where id = p_user;
end $$;
revoke all on function public.admin_delete_account(uuid) from public, anon;
grant execute on function public.admin_delete_account(uuid) to authenticated;

-- the caller's own test pages, gone before a new test sign-up
create or replace function public.test_reset()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not private.is_admin() then raise exception 'admins only'; end if;
  with gone as (
    delete from public.profiles p where p.is_test and exists (select 1 from public.profile_members m where m.profile_id = p.id and m.user_id = (select auth.uid()))
    returning 1)
  select count(*) into n from gone;
  return n;
end $$;
revoke all on function public.test_reset() from public, anon;
grant execute on function public.test_reset() to authenticated;

-- admin_users: say which pages are tests
drop function if exists public.admin_users();
create function public.admin_users()
returns table(profile_id uuid, slug text, display_name text, published boolean, created_at timestamptz, subscription_status text, plan text, members jsonb, is_test boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.slug, p.display_name, p.published, p.created_at, s.status, s.plan,
         coalesce((select jsonb_agg(jsonb_build_object('email', u.email, 'role', m.role) order by m.role desc)
                   from public.profile_members m join auth.users u on u.id = m.user_id where m.profile_id = p.id), '[]'::jsonb),
         p.is_test
  from public.profiles p
  left join public.subscriptions s on s.profile_id = p.id
  where private.is_admin()
  order by p.is_test, p.display_name;
$$;
grant execute on function public.admin_users() to authenticated;
