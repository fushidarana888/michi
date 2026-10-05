alter table public.subjects
  add column if not exists attention_weight smallint not null default 3 check (attention_weight between 1 and 5),
  add column if not exists recommended_gap_days smallint not null default 7 check (recommended_gap_days between 1 and 30),
  add column if not exists learning_phase text not null default 'foundation' check (learning_phase in ('foundation','tools','exam_tasks','mixed','mock'));

create table public.learning_nodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  title text not null,
  description text,
  node_kind text not null default 'tool' check (node_kind in ('foundation','tool','exam_task','practice','checkpoint')),
  sort_order smallint not null default 0,
  status text not null default 'not_started' check (status in ('not_started','learning','assisted','independent','solid')),
  importance smallint not null default 3 check (importance between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, subject_id, title)
);

create table public.study_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  learning_node_id uuid references public.learning_nodes(id) on delete set null,
  minutes smallint not null check (minutes between 1 and 600),
  activity_kind text not null default 'practice' check (activity_kind in ('theory','practice','review','test','lesson','other')),
  perceived_difficulty smallint check (perceived_difficulty between 1 and 4),
  note text,
  occurred_at timestamptz not null default now(),
  source text not null default 'manual' check (source in ('manual','task','ai')),
  created_at timestamptz not null default now()
);

create table public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Переезд в Японию',
  target_amount_jpy bigint not null default 2400000 check (target_amount_jpy > 0),
  target_date date,
  reference_rub_per_jpy numeric(12,6) check (reference_rub_per_jpy is null or reference_rub_per_jpy > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index savings_goals_one_active_per_user_idx
  on public.savings_goals(user_id) where is_active;

create table public.savings_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  savings_goal_id uuid not null references public.savings_goals(id) on delete cascade,
  received_amount_rub numeric(12,2) check (received_amount_rub is null or received_amount_rub >= 0),
  saved_amount_rub numeric(12,2) not null check (saved_amount_rub <> 0),
  source text,
  note text,
  occurred_on date not null default current_date,
  created_at timestamptz not null default now()
);

create index learning_nodes_user_subject_idx on public.learning_nodes(user_id, subject_id, sort_order);
create index study_logs_user_occurred_idx on public.study_logs(user_id, occurred_at desc);
create index study_logs_subject_occurred_idx on public.study_logs(subject_id, occurred_at desc);
create index study_logs_learning_node_idx on public.study_logs(learning_node_id);
create index savings_transactions_user_date_idx on public.savings_transactions(user_id, occurred_on desc);
create index savings_transactions_goal_idx on public.savings_transactions(savings_goal_id);

create trigger learning_nodes_set_updated_at before update on public.learning_nodes
for each row execute function public.set_updated_at();
create trigger savings_goals_set_updated_at before update on public.savings_goals
for each row execute function public.set_updated_at();

alter table public.learning_nodes enable row level security;
alter table public.study_logs enable row level security;
alter table public.savings_goals enable row level security;
alter table public.savings_transactions enable row level security;

create policy "learning_nodes_own_all" on public.learning_nodes
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "study_logs_own_all" on public.study_logs
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "savings_goals_own_all" on public.savings_goals
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "savings_transactions_own_all" on public.savings_transactions
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.learning_nodes to authenticated;
grant select, insert, update, delete on public.study_logs to authenticated;
grant select, insert, update, delete on public.savings_goals to authenticated;
grant select, insert, update, delete on public.savings_transactions to authenticated;
