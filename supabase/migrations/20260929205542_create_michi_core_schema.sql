create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text,
  onboarding_completed boolean not null default false,
  daily_minutes_light smallint not null default 30 check (daily_minutes_light between 10 and 240),
  daily_minutes_normal smallint not null default 75 check (daily_minutes_normal between 10 and 360),
  daily_minutes_boost smallint not null default 110 check (daily_minutes_boost between 10 and 480),
  ai_provider text not null default 'gigachat' check (ai_provider in ('gigachat', 'openai', 'auto')),
  ai_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  slug text not null,
  icon text,
  sort_order smallint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  title text not null,
  description text,
  target_date date,
  status text not null default 'active' check (status in ('active', 'paused', 'completed')),
  progress numeric(5,2) not null default 0 check (progress between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.goal_stages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  title text not null,
  description text,
  sort_order smallint not null default 0,
  starts_on date,
  ends_on date,
  status text not null default 'planned' check (status in ('planned', 'active', 'completed', 'skipped')),
  progress numeric(5,2) not null default 0 check (progress between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.monthly_milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  stage_id uuid references public.goal_stages(id) on delete set null,
  month_start date not null check (extract(day from month_start) = 1),
  title text not null,
  description text,
  target_count integer,
  completed_count integer not null default 0 check (completed_count >= 0),
  status text not null default 'planned' check (status in ('planned', 'active', 'completed', 'skipped')),
  progress numeric(5,2) not null default 0 check (progress between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  name text not null,
  description text,
  mastery numeric(5,2) not null default 0 check (mastery between 0 and 100),
  priority smallint not null default 3 check (priority between 1 and 5),
  last_practiced_at timestamptz,
  next_review_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.daily_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_date date not null,
  target_minutes_light smallint not null default 30 check (target_minutes_light >= 0),
  target_minutes_normal smallint not null default 75 check (target_minutes_normal >= 0),
  target_minutes_boost smallint not null default 110 check (target_minutes_boost >= 0),
  status text not null default 'planned' check (status in ('planned', 'active', 'completed', 'rest')),
  planner_version text not null default 'v0.1',
  note text,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, plan_date)
);

create table public.study_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  daily_plan_id uuid references public.daily_plans(id) on delete cascade,
  goal_id uuid references public.goals(id) on delete set null,
  subject_id uuid references public.subjects(id) on delete set null,
  topic_id uuid references public.topics(id) on delete set null,
  milestone_id uuid references public.monthly_milestones(id) on delete set null,
  title text not null,
  description text,
  task_kind text not null default 'practice' check (
    task_kind in ('theory','practice','review','vocabulary','listening','reading','quiz','essay','custom')
  ),
  tier text not null default 'normal' check (tier in ('minimum','normal','boost')),
  estimated_minutes smallint not null default 15 check (estimated_minutes between 1 and 240),
  difficulty smallint not null default 2 check (difficulty between 1 and 5),
  sort_order smallint not null default 0,
  status text not null default 'planned' check (status in ('planned','in_progress','done','skipped')),
  source text not null default 'planner' check (source in ('planner','ai','manual')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.task_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.study_tasks(id) on delete cascade,
  score numeric(5,2) check (score between 0 and 100),
  perceived_difficulty smallint check (perceived_difficulty between 1 and 4),
  correct_count integer check (correct_count >= 0),
  total_count integer check (total_count >= 0),
  note text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.study_tasks(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  created_at timestamptz not null default now()
);

create table public.mood_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null,
  mood_value smallint not null check (mood_value between 1 and 5),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, entry_date)
);

create table public.mood_entry_reasons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mood_entry_id uuid not null references public.mood_entries(id) on delete cascade,
  reason_key text not null,
  reason_label text not null,
  created_at timestamptz not null default now(),
  unique (mood_entry_id, reason_key)
);

create table public.ai_interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  interaction_kind text not null check (
    interaction_kind in ('explain_mistake','generate_quiz','adapt_plan','tutor_session','chat')
  ),
  provider text not null check (provider in ('gigachat','openai')),
  model text,
  request_summary text,
  response_text text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index subjects_user_id_idx on public.subjects(user_id);
create index goals_user_id_idx on public.goals(user_id);
create index goal_stages_user_id_idx on public.goal_stages(user_id);
create index monthly_milestones_user_id_idx on public.monthly_milestones(user_id);
create index monthly_milestones_month_idx on public.monthly_milestones(user_id, month_start);
create index topics_user_id_idx on public.topics(user_id);
create index topics_subject_idx on public.topics(subject_id);
create index daily_plans_user_date_idx on public.daily_plans(user_id, plan_date);
create index study_tasks_user_id_idx on public.study_tasks(user_id);
create index study_tasks_plan_idx on public.study_tasks(daily_plan_id, sort_order);
create index study_tasks_status_idx on public.study_tasks(user_id, status);
create index task_results_user_id_idx on public.task_results(user_id);
create index study_sessions_user_id_idx on public.study_sessions(user_id);
create index mood_entries_user_date_idx on public.mood_entries(user_id, entry_date);
create index mood_entry_reasons_user_id_idx on public.mood_entry_reasons(user_id);
create index ai_interactions_user_id_idx on public.ai_interactions(user_id, created_at desc);

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger subjects_set_updated_at before update on public.subjects
for each row execute function public.set_updated_at();
create trigger goals_set_updated_at before update on public.goals
for each row execute function public.set_updated_at();
create trigger goal_stages_set_updated_at before update on public.goal_stages
for each row execute function public.set_updated_at();
create trigger monthly_milestones_set_updated_at before update on public.monthly_milestones
for each row execute function public.set_updated_at();
create trigger topics_set_updated_at before update on public.topics
for each row execute function public.set_updated_at();
create trigger daily_plans_set_updated_at before update on public.daily_plans
for each row execute function public.set_updated_at();
create trigger study_tasks_set_updated_at before update on public.study_tasks
for each row execute function public.set_updated_at();
create trigger mood_entries_set_updated_at before update on public.mood_entries
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, 'Ученик'), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.subjects enable row level security;
alter table public.goals enable row level security;
alter table public.goal_stages enable row level security;
alter table public.monthly_milestones enable row level security;
alter table public.topics enable row level security;
alter table public.daily_plans enable row level security;
alter table public.study_tasks enable row level security;
alter table public.task_results enable row level security;
alter table public.study_sessions enable row level security;
alter table public.mood_entries enable row level security;
alter table public.mood_entry_reasons enable row level security;
alter table public.ai_interactions enable row level security;

create policy "profiles_select_own" on public.profiles
for select to authenticated using ((select auth.uid()) = id);
create policy "profiles_update_own" on public.profiles
for update to authenticated using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "subjects_own_all" on public.subjects
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "goals_own_all" on public.goals
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "goal_stages_own_all" on public.goal_stages
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "monthly_milestones_own_all" on public.monthly_milestones
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "topics_own_all" on public.topics
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "daily_plans_own_all" on public.daily_plans
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "study_tasks_own_all" on public.study_tasks
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "task_results_own_all" on public.task_results
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "study_sessions_own_all" on public.study_sessions
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "mood_entries_own_all" on public.mood_entries
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "mood_entry_reasons_own_all" on public.mood_entry_reasons
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "ai_interactions_own_all" on public.ai_interactions
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.subjects to authenticated;
grant select, insert, update, delete on public.goals to authenticated;
grant select, insert, update, delete on public.goal_stages to authenticated;
grant select, insert, update, delete on public.monthly_milestones to authenticated;
grant select, insert, update, delete on public.topics to authenticated;
grant select, insert, update, delete on public.daily_plans to authenticated;
grant select, insert, update, delete on public.study_tasks to authenticated;
grant select, insert, update, delete on public.task_results to authenticated;
grant select, insert, update, delete on public.study_sessions to authenticated;
grant select, insert, update, delete on public.mood_entries to authenticated;
grant select, insert, update, delete on public.mood_entry_reasons to authenticated;
grant select, insert, update, delete on public.ai_interactions to authenticated;
