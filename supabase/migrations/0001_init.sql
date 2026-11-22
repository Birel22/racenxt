-- Racenxt V1 schema
-- Official data: series -> events -> sessions (+ shared venues, vehicles)
-- Athlete data: profiles, members, subscriptions, entries, overrides, sponsors
-- Admin/agents: series_sources, check_runs, proposals
-- Stats: daily counters

create schema if not exists private;

-- ---------------------------------------------------------------
-- Admins (Racenxt team)
-- ---------------------------------------------------------------
create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------
create table public.series (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  short_name text not null,
  sport text not null default 'motorsport',
  logo_url text,
  website_url text,
  watch_url text,
  created_at timestamptz not null default now()
);

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text,
  country text not null,
  country_code text check (country_code ~ '^[A-Z]{2}$'),
  lat double precision,
  lng double precision,
  timezone text not null,            -- IANA, e.g. Europe/Paris
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  display_name text not null,
  first_name text,                   -- used for "<Name> Race Hub"
  sport text not null default 'motorsport',
  photo_url text,
  hero_url text,
  logo_url text,
  bio text,
  socials jsonb not null default '{}'::jsonb,   -- {"instagram": "...", "x": "..."}
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  series_id uuid references public.series (id) on delete cascade,
  owner_profile_id uuid references public.profiles (id) on delete cascade,  -- set = custom event
  ext_key text unique,               -- stable label for official events, e.g. elms-2027-r3
  year int not null check (year between 2000 and 2100),
  round int,
  venue_id uuid references public.venues (id),
  name text not null,
  start_date date not null,
  end_date date not null,
  duration_label text,               -- "24h", "2 x 4h"
  watch_url text,                    -- overrides series.watch_url
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (series_id is not null or owner_profile_id is not null)
);
create index events_series_year_idx on public.events (series_id, year);
create index events_owner_idx on public.events (owner_profile_id) where owner_profile_id is not null;
create index events_venue_idx on public.events (venue_id);
create index events_start_idx on public.events (start_date);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  type text not null check (type in ('practice', 'qualifying', 'race', 'warmup', 'other')),
  label text not null,
  local_start timestamp not null,    -- local venue time, no zone; UTC computed in session_times
  duration_min int not null default 60 check (duration_min > 0),
  category text,
  created_at timestamptz not null default now()
);
create index sessions_event_idx on public.sessions (event_id, local_start);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  manufacturer text,
  category text,
  specs jsonb not null default '[]'::jsonb,   -- [{"label":"Engine","value":"Gibson V8"}]
  photo_url text,
  status text not null default 'pending' check (status in ('approved', 'pending')),
  created_by_profile uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index vehicles_status_idx on public.vehicles (status);
create index vehicles_creator_idx on public.vehicles (created_by_profile);

-- ---------------------------------------------------------------
-- Athlete data
-- ---------------------------------------------------------------
create table public.profile_members (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'editor')),
  created_at timestamptz not null default now(),
  primary key (profile_id, user_id)
);
create index profile_members_user_idx on public.profile_members (user_id);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles (id) on delete cascade,
  plan text not null default 'standard' check (plan in ('standard', 'pro')),
  status text not null default 'inactive' check (status in ('active', 'past_due', 'canceled', 'inactive')),
  provider text not null default 'stripe' check (provider in ('stripe', 'apple', 'google', 'manual')),
  provider_customer_id text,
  provider_subscription_id text,
  current_period_end timestamptz,
  commitment_end date,               -- 12-month minimum
  created_at timestamptz not null default now()
);

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  series_id uuid not null references public.series (id) on delete cascade,
  year int not null,
  team text,
  car_number text,
  category text,
  vehicle_id uuid references public.vehicles (id) on delete set null,
  teammates text[] not null default '{}',
  color text check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now(),
  unique (profile_id, series_id, year)
);
create index entries_series_year_idx on public.entries (series_id, year);
create index entries_vehicle_idx on public.entries (vehicle_id);

create table public.event_overrides (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  hidden boolean not null default false,
  note text,
  primary key (profile_id, event_id)
);
create index event_overrides_event_idx on public.event_overrides (event_id);

create table public.sponsors (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  logo_original_url text,
  logo_white_url text,
  display text not null default 'white' check (display in ('white', 'original')),
  link_url text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index sponsors_profile_idx on public.sponsors (profile_id, sort);

-- ---------------------------------------------------------------
-- Stats (daily counters, no personal data)
-- ---------------------------------------------------------------
create table public.page_views_daily (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  count int not null default 0,
  primary key (profile_id, day)
);

create table public.sponsor_clicks_daily (
  sponsor_id uuid not null references public.sponsors (id) on delete cascade,
  day date not null,
  count int not null default 0,
  primary key (sponsor_id, day)
);

-- ---------------------------------------------------------------
-- Admin and agents
-- ---------------------------------------------------------------
create table public.series_sources (
  series_id uuid primary key references public.series (id) on delete cascade,
  urls jsonb not null default '[]'::jsonb,          -- [{"kind":"calendar","url":"..."}]
  allowed_domains text[] not null default '{}',
  agent_instructions text not null default ''
);

create table public.check_runs (
  id uuid primary key default gen_random_uuid(),
  series_id uuid references public.series (id) on delete cascade,
  event_id uuid references public.events (id) on delete cascade,
  kind text not null check (kind in ('monthly', 'weekly', 'daily', 'final', 'manual')),
  ran_at timestamptz not null default now(),
  pages jsonb not null default '[]'::jsonb,         -- [{"url":"...","fingerprint":"..."}]
  result text not null check (result in ('no_change', 'proposal', 'error', 'skipped_unchanged')),
  error text
);
create index check_runs_series_idx on public.check_runs (series_id, ran_at desc);
create index check_runs_event_idx on public.check_runs (event_id);

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.check_runs (id) on delete set null,
  series_id uuid references public.series (id) on delete cascade,
  event_id uuid references public.events (id) on delete cascade,
  kind text not null check (kind in ('new_event', 'event_change', 'event_cancelled', 'timetable', 'watch_link', 'new_season')),
  payload jsonb not null,            -- proposed data (local times only)
  diff jsonb,
  evidence jsonb not null,           -- {"url":"...","excerpt":"..."}
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewer uuid references auth.users (id),
  reason text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index proposals_status_idx on public.proposals (status, created_at);
create index proposals_series_idx on public.proposals (series_id);
create index proposals_event_idx on public.proposals (event_id);
create index proposals_run_idx on public.proposals (run_id);
create index proposals_reviewer_idx on public.proposals (reviewer);

-- ---------------------------------------------------------------
-- Session times in UTC (computed from venue time zone)
-- ---------------------------------------------------------------
create view public.session_times with (security_invoker = true) as
select s.*,
       v.timezone,
       (s.local_start at time zone v.timezone) as start_utc,
       (s.local_start at time zone v.timezone) + make_interval(mins => s.duration_min) as end_utc
from public.sessions s
join public.events e on e.id = s.event_id
join public.venues v on v.id = e.venue_id;

-- ---------------------------------------------------------------
-- Helper functions (private schema, not exposed by the API)
-- ---------------------------------------------------------------
create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.admins where user_id = (select auth.uid())) $$;

create or replace function private.profile_role(p uuid)
returns text language sql stable security definer set search_path = ''
as $$ select role from public.profile_members where profile_id = p and user_id = (select auth.uid()) $$;

create or replace function private.is_published(p uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce((select published from public.profiles where id = p), false) $$;

grant usage on schema private to anon, authenticated;
grant execute on function private.is_admin(), private.profile_role(uuid), private.is_published(uuid) to anon, authenticated;

-- Public counters (anyone can increment, nothing else)
create or replace function public.track_view(p_slug text)
returns void language sql security definer set search_path = ''
as $$
  insert into public.page_views_daily (profile_id, day, count)
  select id, current_date, 1 from public.profiles where slug = p_slug and published
  on conflict (profile_id, day) do update set count = public.page_views_daily.count + 1;
$$;

create or replace function public.track_sponsor_click(p_sponsor uuid)
returns void language sql security definer set search_path = ''
as $$
  insert into public.sponsor_clicks_daily (sponsor_id, day, count)
  select s.id, current_date, 1 from public.sponsors s
  join public.profiles p on p.id = s.profile_id and p.published
  where s.id = p_sponsor
  on conflict (sponsor_id, day) do update set count = public.sponsor_clicks_daily.count + 1;
$$;
grant execute on function public.track_view(text), public.track_sponsor_click(uuid) to anon, authenticated;

-- New profile: creator becomes owner
create or replace function public.create_profile(p_slug text, p_display_name text, p_first_name text default null, p_sport text default 'motorsport')
returns uuid language plpgsql security definer set search_path = ''
as $$
declare new_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'not signed in'; end if;
  insert into public.profiles (slug, display_name, first_name, sport)
  values (lower(p_slug), p_display_name, p_first_name, p_sport) returning id into new_id;
  insert into public.profile_members (profile_id, user_id, role) values (new_id, (select auth.uid()), 'owner');
  insert into public.subscriptions (profile_id) values (new_id);
  return new_id;
end $$;
revoke execute on function public.create_profile(text, text, text, text) from public, anon;
grant execute on function public.create_profile(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------
alter table public.admins enable row level security;
alter table public.series enable row level security;
alter table public.venues enable row level security;
alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.sessions enable row level security;
alter table public.vehicles enable row level security;
alter table public.profile_members enable row level security;
alter table public.subscriptions enable row level security;
alter table public.entries enable row level security;
alter table public.event_overrides enable row level security;
alter table public.sponsors enable row level security;
alter table public.page_views_daily enable row level security;
alter table public.sponsor_clicks_daily enable row level security;
alter table public.series_sources enable row level security;
alter table public.check_runs enable row level security;
alter table public.proposals enable row level security;

-- Admins
create policy admins_self on public.admins for select to authenticated using (user_id = (select auth.uid()));

-- Reference data: everyone reads, admins write
create policy series_read on public.series for select to anon, authenticated using (true);
create policy series_admin on public.series for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy venues_read on public.venues for select to anon, authenticated using (true);
create policy venues_admin on public.venues for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
-- members can add a venue for a custom event
create policy venues_member_insert on public.venues for insert to authenticated with check ((select auth.uid()) is not null);

-- Profiles
create policy profiles_read on public.profiles for select to anon, authenticated
  using (published or (select private.profile_role(id)) is not null or (select private.is_admin()));
create policy profiles_update on public.profiles for update to authenticated
  using ((select private.profile_role(id)) is not null) with check ((select private.profile_role(id)) is not null);
create policy profiles_delete on public.profiles for delete to authenticated
  using ((select private.profile_role(id)) = 'owner');

-- Events: official ones public; custom ones visible when profile published or to members
create policy events_read on public.events for select to anon, authenticated
  using (owner_profile_id is null or (select private.is_published(owner_profile_id)) or (select private.profile_role(owner_profile_id)) is not null);
create policy events_admin on public.events for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy events_member_insert on public.events for insert to authenticated
  with check (owner_profile_id is not null and series_id is null and (select private.profile_role(owner_profile_id)) is not null);
create policy events_member_update on public.events for update to authenticated
  using (owner_profile_id is not null and (select private.profile_role(owner_profile_id)) is not null)
  with check (owner_profile_id is not null and series_id is null and (select private.profile_role(owner_profile_id)) is not null);
create policy events_member_delete on public.events for delete to authenticated
  using (owner_profile_id is not null and (select private.profile_role(owner_profile_id)) = 'owner');

-- Sessions follow their event
create policy sessions_read on public.sessions for select to anon, authenticated
  using (exists (select 1 from public.events e where e.id = event_id));
create policy sessions_admin on public.sessions for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy sessions_member_write on public.sessions for insert to authenticated
  with check (exists (select 1 from public.events e where e.id = event_id and e.owner_profile_id is not null and (select private.profile_role(e.owner_profile_id)) is not null));
create policy sessions_member_update on public.sessions for update to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and e.owner_profile_id is not null and (select private.profile_role(e.owner_profile_id)) is not null));
create policy sessions_member_delete on public.sessions for delete to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and e.owner_profile_id is not null and (select private.profile_role(e.owner_profile_id)) = 'owner'));

-- Vehicles: approved public; pending visible to creator; members create pending
create policy vehicles_read on public.vehicles for select to anon, authenticated
  using (status = 'approved' or (created_by_profile is not null and ((select private.is_published(created_by_profile)) or (select private.profile_role(created_by_profile)) is not null)));
create policy vehicles_admin on public.vehicles for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy vehicles_member_insert on public.vehicles for insert to authenticated
  with check (status = 'pending' and (select private.profile_role(created_by_profile)) is not null);
create policy vehicles_member_update on public.vehicles for update to authenticated
  using (status = 'pending' and (select private.profile_role(created_by_profile)) is not null)
  with check (status = 'pending' and (select private.profile_role(created_by_profile)) is not null);

-- Members: see your own memberships and others on profiles you own; owners manage
create policy members_read on public.profile_members for select to authenticated
  using (user_id = (select auth.uid()) or (select private.profile_role(profile_id)) = 'owner');
create policy members_owner_write on public.profile_members for all to authenticated
  using ((select private.profile_role(profile_id)) = 'owner')
  with check ((select private.profile_role(profile_id)) = 'owner');

-- Subscriptions: owner reads; writes only by server (service role)
create policy subscriptions_read on public.subscriptions for select to authenticated
  using ((select private.profile_role(profile_id)) = 'owner' or (select private.is_admin()));

-- Entries, overrides, sponsors: public when published; members add/edit; owner deletes
create policy entries_read on public.entries for select to anon, authenticated
  using ((select private.is_published(profile_id)) or (select private.profile_role(profile_id)) is not null);
create policy entries_insert on public.entries for insert to authenticated with check ((select private.profile_role(profile_id)) is not null);
create policy entries_update on public.entries for update to authenticated
  using ((select private.profile_role(profile_id)) is not null) with check ((select private.profile_role(profile_id)) is not null);
create policy entries_delete on public.entries for delete to authenticated using ((select private.profile_role(profile_id)) = 'owner');

create policy overrides_read on public.event_overrides for select to anon, authenticated
  using ((select private.is_published(profile_id)) or (select private.profile_role(profile_id)) is not null);
create policy overrides_insert on public.event_overrides for insert to authenticated with check ((select private.profile_role(profile_id)) is not null);
create policy overrides_update on public.event_overrides for update to authenticated
  using ((select private.profile_role(profile_id)) is not null) with check ((select private.profile_role(profile_id)) is not null);
create policy overrides_delete on public.event_overrides for delete to authenticated using ((select private.profile_role(profile_id)) = 'owner');

create policy sponsors_read on public.sponsors for select to anon, authenticated
  using ((select private.is_published(profile_id)) or (select private.profile_role(profile_id)) is not null);
create policy sponsors_insert on public.sponsors for insert to authenticated with check ((select private.profile_role(profile_id)) is not null);
create policy sponsors_update on public.sponsors for update to authenticated
  using ((select private.profile_role(profile_id)) is not null) with check ((select private.profile_role(profile_id)) is not null);
create policy sponsors_delete on public.sponsors for delete to authenticated using ((select private.profile_role(profile_id)) = 'owner');

-- Stats: members and admins read; writes only via track_* functions
create policy views_read on public.page_views_daily for select to authenticated
  using ((select private.profile_role(profile_id)) is not null or (select private.is_admin()));
create policy clicks_read on public.sponsor_clicks_daily for select to authenticated
  using (exists (select 1 from public.sponsors s where s.id = sponsor_id and (select private.profile_role(s.profile_id)) is not null) or (select private.is_admin()));

-- Admin/agent tables: admins only (agents use the service role, which bypasses RLS)
create policy sources_admin on public.series_sources for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy runs_admin on public.check_runs for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy proposals_admin on public.proposals for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

-- Storage bucket for photos and logos (public read)
insert into storage.buckets (id, name, public) values ('media', 'media', true) on conflict (id) do nothing;
create policy media_write on storage.objects for insert to authenticated with check (bucket_id = 'media' and (select auth.uid()) is not null);
create policy media_update on storage.objects for update to authenticated using (bucket_id = 'media' and owner = (select auth.uid()));
create policy media_delete on storage.objects for delete to authenticated using (bucket_id = 'media' and owner = (select auth.uid()));
