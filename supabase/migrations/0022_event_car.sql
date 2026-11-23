-- A custom event can have its own car (from the catalogue, optionally with the athlete's photo)
alter table public.events add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null;
alter table public.events add column if not exists car_photo_url text;
create index if not exists events_vehicle_id_idx on public.events(vehicle_id);
