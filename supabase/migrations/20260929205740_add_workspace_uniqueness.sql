alter table public.topics
  add constraint topics_user_subject_name_key unique (user_id, subject_id, name);

alter table public.monthly_milestones
  add constraint monthly_milestones_goal_month_key unique (goal_id, month_start);
