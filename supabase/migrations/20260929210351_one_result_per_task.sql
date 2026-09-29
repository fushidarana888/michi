alter table public.task_results
  add constraint task_results_task_id_key unique (task_id);
