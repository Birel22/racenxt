-- Partner logos use the same editor as the athlete's logo: Original / White / Black.
-- logo_original_url = the cut-out original (kept so the colour can change later), logo_url = what fans see.
alter table public.sponsors add column if not exists logo_url text;
alter table public.sponsors drop constraint if exists sponsors_display_check;
alter table public.sponsors add constraint sponsors_display_check check (display = any (array['white','original','black']));
