-- No waiting: the scheduler runs around the clock, and the timetable search starts as soon as a calendar is approved;
-- each race checked right after an import starts the next one straight away (one at a time, in date order).
select cron.alter_job((select jobid from cron.job where jobname = 'agent-tick'), schedule := '*/15 * * * *');

create or replace function private.kick_agent() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  perform net.http_post(
    url := 'https://cfpbrfqdtgwpxthehpgz.supabase.co/functions/v1/agent',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from public.agent_secrets where key = 'cron')),
    body := '{"action":"tick"}'::jsonb);
  return null;
end $$;

drop trigger if exists kick_after_calendar on public.proposals;
create trigger kick_after_calendar after update of status on public.proposals
  for each row when (new.status = 'approved' and old.status = 'pending' and new.kind in ('new_season', 'new_event'))
  execute function private.kick_agent();

drop trigger if exists kick_next_initial on public.check_runs;
create trigger kick_next_initial after update of result on public.check_runs
  for each row when (new.kind = 'initial' and old.result = 'running' and new.result <> 'running')
  execute function private.kick_agent();
