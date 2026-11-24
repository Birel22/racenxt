-- Which class races where is its own agent job ("classes"), with its own time budget.
-- It starts when the new races of a shared calendar are approved (the approved season carries the classes).
alter table public.check_runs drop constraint if exists check_runs_kind_check;
alter table public.check_runs add constraint check_runs_kind_check check (kind = any (array[
  'monthly', 'weekly', 'daily', 'final', 'manual', 'discover', 'initial', 'icon', 'classes']));

create or replace function private.kick_agent()
returns trigger language plpgsql security definer set search_path to '' as $function$
declare sec text := (select value from public.agent_secrets where key = 'cron');
begin
  perform net.http_post(
    url := 'https://cfpbrfqdtgwpxthehpgz.supabase.co/functions/v1/agent',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', sec),
    body := '{"action":"tick"}'::jsonb);
  if (select array_length(classes, 1) from public.series where id = new.series_id) > 1 then
    perform net.http_post(
      url := 'https://cfpbrfqdtgwpxthehpgz.supabase.co/functions/v1/agent',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', sec),
      body := jsonb_build_object('action', 'classes', 'series_id', new.series_id));
  end if;
  return null;
end $function$;
