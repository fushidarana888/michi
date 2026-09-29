revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

create index if not exists goal_stages_goal_id_idx on public.goal_stages(goal_id);
create index if not exists goals_subject_id_idx on public.goals(subject_id);
create index if not exists monthly_milestones_stage_id_idx on public.monthly_milestones(stage_id);
create index if not exists study_sessions_task_id_idx on public.study_sessions(task_id);
create index if not exists study_tasks_goal_id_idx on public.study_tasks(goal_id);
create index if not exists study_tasks_milestone_id_idx on public.study_tasks(milestone_id);
create index if not exists study_tasks_subject_id_idx on public.study_tasks(subject_id);
create index if not exists study_tasks_topic_id_idx on public.study_tasks(topic_id);
create index if not exists task_results_task_id_idx on public.task_results(task_id);
