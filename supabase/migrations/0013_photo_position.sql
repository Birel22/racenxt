-- How the user framed their page photo: focal point (0-100 %) and zoom
alter table public.profiles add column if not exists photo_pos jsonb;
