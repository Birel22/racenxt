-- Custom events can carry their own links (Where to watch, Live timing, Tickets, anything): [{label, url}]
alter table public.events add column if not exists links jsonb not null default '[]'::jsonb;
alter table public.events add constraint events_links_array check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 8);
