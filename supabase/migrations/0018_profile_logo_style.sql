-- personal logo: logo_url is what fans see; logo_src_url keeps the cleaned-up original so the colour can change without uploading again
alter table public.profiles add column if not exists logo_src_url text,
  add column if not exists logo_style text not null default 'original' check (logo_style in ('original','white','black'));
