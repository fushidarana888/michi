alter table public.savings_transactions
  drop constraint if exists savings_transactions_saved_amount_rub_check;

alter table public.savings_transactions
  add constraint savings_transactions_has_movement_check
  check (coalesce(received_amount_rub, 0) > 0 or saved_amount_rub <> 0);
