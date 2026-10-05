alter table public.savings_goals
  add column protected_floor_rub numeric(12,2) not null default 0 check (protected_floor_rub >= 0),
  add column auto_floor_ratio numeric(4,3) not null default 0.700 check (auto_floor_ratio between 0 and 1),
  add column base_save_ratio numeric(4,3) not null default 0.400 check (base_save_ratio between 0 and 1);

comment on column public.savings_goals.protected_floor_rub is 'Manual minimum amount the user wants to consider protected from everyday spending.';
comment on column public.savings_goals.auto_floor_ratio is 'Share of historical peak savings used to calculate an automatic protected floor.';
comment on column public.savings_goals.base_save_ratio is 'Soft baseline share of new income used for savings guidance; never enforced.';
