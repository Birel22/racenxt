-- What a vehicle looks like, for the icon fans tap to see its specs: a prototype, a GT, a single-seater, a kart, a motorbike.
-- One value per car (the same in every championship). Empty = guessed from its classes, then from the championship.
alter table public.vehicles add column if not exists kind text;
alter table public.vehicles drop constraint if exists vehicles_kind_check;
alter table public.vehicles add constraint vehicles_kind_check check (kind is null or kind in ('proto', 'gt', 'formula', 'kart', 'bike'));
update public.vehicles set kind = case
  when category = 'kart chassis' then 'kart'
  when category ~* '(lmp|hypercar|gtp|prototype)' then 'proto'
  when category ~* '(^|[^a-z])(gt|gtd)' then 'gt'
end where kind is null;
