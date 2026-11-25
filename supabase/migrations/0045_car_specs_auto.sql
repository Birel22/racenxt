-- Cars that arrive in the library (or are suggested for it) with no specs: the agent looks them up once, right away.
-- One call per batch of new cars (statement trigger), a cheap model, a few cars per question; only empty fields are filled.
-- A car is looked up once (specs_tried_at): one it can't find isn't searched again and again.
-- Also: a new car gets its type (prototype / GT / kart) from its category when none is set.
alter table public.vehicles add column if not exists specs_tried_at timestamptz;
alter table public.check_runs drop constraint if exists check_runs_kind_check;
alter table public.check_runs add constraint check_runs_kind_check check (kind = any (array['monthly','weekly','daily','final','manual','discover','initial','icon','classes','cars','class_format','specs']));

create or replace function private.vehicle_kind_guess() returns trigger language plpgsql as $$
begin
  if new.kind is null then
    new.kind := case
      when new.category = 'kart chassis' then 'kart'
      when new.category ~* '(lmp|hypercar|gtp|prototype)' then 'proto'
      when new.category ~* '(^|[^a-z])(gt|gtd)' then 'gt'
    end;
  end if;
  return new;
end $$;
drop trigger if exists vehicles_kind_guess on public.vehicles;
create trigger vehicles_kind_guess before insert or update of category on public.vehicles
  for each row execute function private.vehicle_kind_guess();
update public.vehicles set category = category where kind is null and category is not null;

create or replace function private.specs_kick() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from nt where (nt.status = 'approved' or nt.suggested) and nt.engine is null and nt.power is null and nt.weight is null and nt.specs_tried_at is null) then
    perform net.http_post(
      url := 'https://cfpbrfqdtgwpxthehpgz.supabase.co/functions/v1/agent',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from public.agent_secrets where key = 'cron')),
      body := '{"action":"specs"}'::jsonb,
      timeout_milliseconds := 20000);
  end if;
  return null;
end $$;
drop trigger if exists vehicles_specs_ins on public.vehicles;
create trigger vehicles_specs_ins after insert on public.vehicles referencing new table as nt
  for each statement execute function private.specs_kick();
-- approved later (an athlete's suggestion, or an admin ticking "in the catalogue")
create or replace function private.specs_kick_row() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.status = 'approved' or new.suggested) and new.engine is null and new.power is null and new.weight is null and new.specs_tried_at is null then
    perform net.http_post(
      url := 'https://cfpbrfqdtgwpxthehpgz.supabase.co/functions/v1/agent',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from public.agent_secrets where key = 'cron')),
      body := '{"action":"specs"}'::jsonb,
      timeout_milliseconds := 20000);
  end if;
  return null;
end $$;
drop trigger if exists vehicles_specs_upd on public.vehicles;
create trigger vehicles_specs_upd after update of status, suggested on public.vehicles
  for each row when (old.status is distinct from new.status or old.suggested is distinct from new.suggested)
  execute function private.specs_kick_row();
