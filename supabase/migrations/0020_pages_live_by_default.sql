-- No draft pages: a Race Hub is public as soon as it's created.
-- "published" stays only as an admin switch to take a page down.
alter table public.profiles alter column published set default true;
update public.profiles set published = true where published = false;
