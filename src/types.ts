export type Tier = 'minimum' | 'normal' | 'boost'
export type TaskStatus = 'planned' | 'in_progress' | 'done' | 'skipped'
export type LearningStatus = 'not_started' | 'learning' | 'assisted' | 'independent' | 'solid'
export type LearningPhase = 'foundation' | 'tools' | 'exam_tasks' | 'mixed' | 'mock'

export interface Profile {
  id: string
  display_name: string | null
  timezone: string | null
  onboarding_completed: boolean
  daily_minutes_light: number
  daily_minutes_normal: number
  daily_minutes_boost: number
  ai_provider: 'gigachat' | 'openai' | 'auto'
  ai_model: string | null
}

export interface Subject {
  id: string
  user_id: string
  name: string
  slug: string
  icon: string | null
  sort_order: number
  is_active: boolean
  attention_weight: number
  recommended_gap_days: number
  learning_phase: LearningPhase
}

export interface Topic {
  id: string
  user_id: string
  subject_id: string
  name: string
  description: string | null
  mastery: number
  priority: number
  last_practiced_at: string | null
  next_review_at: string | null
  is_active: boolean
}

export interface Goal {
  id: string
  user_id: string
  subject_id: string | null
  title: string
  description: string | null
  target_date: string | null
  status: 'active' | 'paused' | 'completed'
  progress: number
}

export interface LearningNode {
  id: string
  user_id: string
  subject_id: string
  title: string
  description: string | null
  node_kind: 'foundation' | 'tool' | 'exam_task' | 'practice' | 'checkpoint'
  sort_order: number
  status: LearningStatus
  importance: number
}

export interface StudyLog {
  id: string
  user_id: string
  subject_id: string
  learning_node_id: string | null
  minutes: number
  activity_kind: 'theory' | 'practice' | 'review' | 'test' | 'lesson' | 'other'
  perceived_difficulty: number | null
  note: string | null
  occurred_at: string
  source: 'manual' | 'task' | 'ai'
}

export interface SavingsGoal {
  id: string
  user_id: string
  title: string
  target_amount_jpy: number
  target_date: string | null
  reference_rub_per_jpy: number | null
  is_active: boolean
}

export interface SavingsTransaction {
  id: string
  user_id: string
  savings_goal_id: string
  received_amount_rub: number | null
  saved_amount_rub: number
  source: string | null
  note: string | null
  occurred_on: string
  created_at: string
}

export interface DailyPlan {
  id: string
  user_id: string
  plan_date: string
  target_minutes_light: number
  target_minutes_normal: number
  target_minutes_boost: number
  status: string
}

export interface StudyTask {
  id: string
  user_id: string
  daily_plan_id: string | null
  goal_id: string | null
  subject_id: string | null
  topic_id: string | null
  title: string
  description: string | null
  task_kind: string
  tier: Tier
  estimated_minutes: number
  difficulty: number
  sort_order: number
  status: TaskStatus
  completed_at: string | null
  subject?: Subject | null
  topic?: Topic | null
}

export interface MoodEntry {
  id: string
  user_id: string
  entry_date: string
  mood_value: number
  note: string | null
}
