-- Account security: admin needs the authenticator-app step (aal2), devices list, delete my account.
create or replace function private.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()))
     and coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
$$;
create or replace function public.admin_status() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'admin', exists (select 1 from public.admins where user_id = (select auth.uid())),
    'aal', coalesce((select auth.jwt() ->> 'aal'), 'aal1'),
    'has_factor', exists (select 1 from auth.mfa_factors where user_id = (select auth.uid()) and status = 'verified')
  )
$$;
revoke all on function public.admin_status() from public, anon;
grant execute on function public.admin_status() to authenticated;
create or replace function public.my_sessions() returns table (id uuid, user_agent text, ip text, created_at timestamptz, last_used timestamptz, current boolean)
language sql stable security definer set search_path = '' as $$
  select s.id, s.user_agent, host(s.ip), s.created_at, coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at),
         s.id::text = coalesce((select auth.jwt() ->> 'session_id'), '')
  from auth.sessions s where s.user_id = (select auth.uid())
  order by coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at) desc
$$;
revoke all on function public.my_sessions() from public, anon;
grant execute on function public.my_sessions() to authenticated;
create or replace function public.end_my_session(sid uuid) returns void language sql security definer set search_path = '' as $$
  delete from auth.sessions where id = sid and user_id = (select auth.uid())
$$;
revoke all on function public.end_my_session(uuid) from public, anon;
grant execute on function public.end_my_session(uuid) to authenticated;
create or replace function public.delete_my_account() returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'not signed in'; end if;
  if exists (select 1 from public.admins where user_id = me) then raise exception 'Admin accounts can''t be deleted from the app'; end if;
  delete from public.profiles p where exists (select 1 from public.profile_members m where m.profile_id = p.id and m.user_id = me and m.role = 'owner')
    and not exists (select 1 from public.profile_members m2 where m2.profile_id = p.id and m2.role = 'owner' and m2.user_id <> me);
  update public.proposals set reviewer = null where reviewer = me;
  delete from auth.users where id = me;
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
