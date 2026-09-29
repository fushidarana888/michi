import { supabase } from './supabase'
import { daysSince, localDateKey } from './date'
import type { DailyPlan, Profile, StudyTask, Subject, Tier, Topic } from '../types'

const tierRank: Record<Tier, number> = { minimum: 0, normal: 1, boost: 2 }

function topicScore(topic: Topic) {
  return topic.priority * 18 + (100 - Number(topic.mastery || 0)) + Math.min(daysSince(topic.last_practiced_at), 30) * 2
}

function chooseTopic(topics: Topic[], subjectId: string, offset = 0) {
  const candidates = topics
    .filter((topic) => topic.subject_id === subjectId && topic.is_active)
    .sort((a, b) => topicScore(b) - topicScore(a))
  if (!candidates.length) return null
  return candidates[offset % candidates.length]
}

function variantForSubject(slug: string, dayIndex: number, extra = false): [string, string] {
  if (slug === 'japanese') {
    const variants: Array<[string, string]> = extra
      ? [
          ['Короткое аудирование', 'listening'],
          ['Мини-чтение', 'reading'],
          ['Повторение слов', 'review'],
        ]
      : [
          ['Слова + повторение', 'vocabulary'],
          ['Грамматика на практике', 'practice'],
          ['Аудирование', 'listening'],
          ['Чтение', 'reading'],
        ]
    return variants[dayIndex % variants.length]
  }

  if (slug === 'math') {
    const variants: Array<[string, string]> = [
      ['Практика по теме', 'practice'],
      ['Разбор теории + задачи', 'theory'],
      ['Повторение ошибок', 'review'],
      ['Мини-тест', 'quiz'],
    ]
    return variants[dayIndex % variants.length]
  }

  const variants: Array<[string, string]> = [
    ['Практика задания', 'practice'],
    ['Теория + примеры', 'theory'],
    ['Повторение ошибок', 'review'],
    ['Мини-тест', 'quiz'],
  ]
  return variants[dayIndex % variants.length]
}

export async function ensureTodayPlan(userId: string, profile: Profile) {
  const planDate = localDateKey()

  const existing = await supabase
    .from('daily_plans')
    .select('*')
    .eq('user_id', userId)
    .eq('plan_date', planDate)
    .maybeSingle()

  let plan = existing.data as DailyPlan | null

  if (!plan) {
    const created = await supabase
      .from('daily_plans')
      .insert({
        user_id: userId,
        plan_date: planDate,
        target_minutes_light: profile.daily_minutes_light,
        target_minutes_normal: profile.daily_minutes_normal,
        target_minutes_boost: profile.daily_minutes_boost,
        status: 'active',
      })
      .select('*')
      .single()

    if (created.error) throw created.error
    plan = created.data as DailyPlan
  }

  const currentTasks = await supabase
    .from('study_tasks')
    .select('*')
    .eq('user_id', userId)
    .eq('daily_plan_id', plan.id)
    .order('sort_order')

  if (currentTasks.error) throw currentTasks.error
  if (currentTasks.data?.length) {
    return { plan, tasks: currentTasks.data as StudyTask[] }
  }

  const [subjectsResult, topicsResult, goalsResult] = await Promise.all([
    supabase.from('subjects').select('*').eq('user_id', userId).eq('is_active', true).order('sort_order'),
    supabase.from('topics').select('*').eq('user_id', userId).eq('is_active', true),
    supabase.from('goals').select('*').eq('user_id', userId).eq('status', 'active'),
  ])

  if (subjectsResult.error) throw subjectsResult.error
  if (topicsResult.error) throw topicsResult.error
  if (goalsResult.error) throw goalsResult.error

  const subjects = (subjectsResult.data || []) as Subject[]
  const topics = (topicsResult.data || []) as Topic[]
  const goals = goalsResult.data || []
  const bySlug = Object.fromEntries(subjects.map((subject) => [subject.slug, subject])) as Record<string, Subject>
  const dayIndex = Math.floor(Date.now() / 86_400_000)

  const weakestAcademic = ['math', 'russian']
    .map((slug) => bySlug[slug])
    .filter((value): value is Subject => Boolean(value))
    .sort((a, b) => {
      const ta = chooseTopic(topics, a.id)
      const tb = chooseTopic(topics, b.id)
      return (tb ? topicScore(tb) : 0) - (ta ? topicScore(ta) : 0)
    })

  const taskBlueprints: Array<{ subject: Subject; topic: Topic | null; minutes: number; tier: Tier; extra?: boolean }> = []

  if (bySlug.japanese) {
    taskBlueprints.push({
      subject: bySlug.japanese,
      topic: chooseTopic(topics, bySlug.japanese.id),
      minutes: 10,
      tier: 'minimum',
    })
  }

  if (weakestAcademic[0]) {
    taskBlueprints.push({
      subject: weakestAcademic[0],
      topic: chooseTopic(topics, weakestAcademic[0].id),
      minutes: 20,
      tier: 'minimum',
    })
  }

  if (weakestAcademic[1]) {
    taskBlueprints.push({
      subject: weakestAcademic[1],
      topic: chooseTopic(topics, weakestAcademic[1].id),
      minutes: 25,
      tier: 'normal',
    })
  }

  if (bySlug.japanese) {
    taskBlueprints.push({
      subject: bySlug.japanese,
      topic: chooseTopic(topics, bySlug.japanese.id, 1),
      minutes: 10,
      tier: 'normal',
      extra: true,
    })
  }

  const boostSubject = weakestAcademic[0] || bySlug.japanese
  if (boostSubject) {
    taskBlueprints.push({
      subject: boostSubject,
      topic: chooseTopic(topics, boostSubject.id, 1),
      minutes: 25,
      tier: 'boost',
      extra: true,
    })
  }

  const inserts = taskBlueprints.map((item, index) => {
    const variant = variantForSubject(item.subject.slug, dayIndex + index, item.extra)
    const goal = goals.find((candidate) => candidate.subject_id === item.subject.id)

    return {
      user_id: userId,
      daily_plan_id: plan!.id,
      goal_id: goal?.id || null,
      subject_id: item.subject.id,
      topic_id: item.topic?.id || null,
      title: item.topic ? item.topic.name : item.subject.name,
      description: variant[0],
      task_kind: variant[1],
      tier: item.tier,
      estimated_minutes: item.minutes,
      difficulty: item.tier === 'boost' ? 3 : 2,
      sort_order: index,
      status: 'planned',
      source: 'planner',
    }
  })

  if (!inserts.length) return { plan, tasks: [] as StudyTask[] }

  const createdTasks = await supabase.from('study_tasks').insert(inserts).select('*').order('sort_order')
  if (createdTasks.error) throw createdTasks.error

  return { plan, tasks: createdTasks.data as StudyTask[] }
}

export function taskVisibleAtTier(taskTier: Tier, selected: Tier) {
  return tierRank[taskTier] <= tierRank[selected]
}
