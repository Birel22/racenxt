alter table public.check_runs drop constraint check_runs_kind_check;
alter table public.check_runs add constraint check_runs_kind_check check (kind in ('monthly','weekly','daily','final','manual','discover','initial','icon'));
alter table public.check_runs alter column series_id drop not null;
