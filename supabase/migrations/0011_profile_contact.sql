-- Sign-up asks for first name, last name, photo, socials, website and a contact email
alter table public.profiles add column if not exists last_name text, add column if not exists contact_email text;
