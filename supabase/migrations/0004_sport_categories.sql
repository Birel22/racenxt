-- Three sport categories (used for filters and for the vehicle icon)
update public.series set sport = 'formula' where slug in ('f2','f3');
update public.series set sport = 'sportscars' where sport not in ('formula','motorbikes');
alter table public.series alter column sport set default 'sportscars';
alter table public.series add constraint series_sport_check check (sport in ('sportscars','formula','motorbikes'));
