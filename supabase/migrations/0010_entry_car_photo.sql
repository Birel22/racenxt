-- Each user adds the photo of their own car (their livery); the vehicle library holds specs only
alter table public.entries add column if not exists car_photo_url text;
