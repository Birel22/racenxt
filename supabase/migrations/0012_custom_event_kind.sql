-- Users' own events (no championship): what kind of event it is, shown on the race card
alter table public.events add column if not exists kind text check (kind in ('test', 'appearance', 'simulator', 'media', 'other'));
