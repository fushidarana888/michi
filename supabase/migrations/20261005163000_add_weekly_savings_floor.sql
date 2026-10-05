alter table public.savings_goals
  add column if not exists weekly_floor_rub numeric not null default 0,
  add column if not exists weekly_floor_increment_rub numeric not null default 300,
  add column if not exists weekly_floor_last_bump_on date not null default current_date;

alter table public.savings_goals
  drop constraint if exists savings_goals_weekly_floor_rub_nonnegative,
  add constraint savings_goals_weekly_floor_rub_nonnegative check (weekly_floor_rub >= 0),
  drop constraint if exists savings_goals_weekly_floor_increment_rub_nonnegative,
  add constraint savings_goals_weekly_floor_increment_rub_nonnegative check (weekly_floor_increment_rub >= 0);

update public.savings_goals sg
set weekly_floor_rub = greatest(
  sg.weekly_floor_rub,
  coalesce((
    select sum(st.saved_amount_rub)
    from public.savings_transactions st
    where st.savings_goal_id = sg.id
  ), 0)
),
weekly_floor_last_bump_on = current_date;

create or replace function public.advance_savings_weekly_floor(p_goal_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_weeks integer;
  v_last date;
  v_increment numeric;
begin
  select weekly_floor_last_bump_on, weekly_floor_increment_rub
    into v_last, v_increment
  from public.savings_goals
  where id = p_goal_id
    and user_id = (select auth.uid())
  for update;

  if not found then
    return;
  end if;

  v_weeks := greatest(0, floor((current_date - v_last) / 7.0)::integer);

  if v_weeks > 0 then
    update public.savings_goals
    set weekly_floor_rub = weekly_floor_rub + (v_weeks * v_increment),
        weekly_floor_last_bump_on = v_last + (v_weeks * 7),
        updated_at = now()
    where id = p_goal_id
      and user_id = (select auth.uid());
  end if;
end;
$$;

revoke all on function public.advance_savings_weekly_floor(uuid) from public;
grant execute on function public.advance_savings_weekly_floor(uuid) to authenticated;
