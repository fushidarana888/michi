import { STUDY_PRESETS } from '../data/presets'
import type { Goal, LearningNode, StudyLog, Subject } from '../types'
import { daysSince } from './date'
import { supabase } from './supabase'

const PREFERRED_NODE_PREFIX = 'michi-preferred-node:'

export interface AttentionCard {
  subject: Subject
  minutes: number
  share: number
  targetShare: number
  daysSinceLast: number | null
  currentNode: LearningNode | null
  score: number
  state: 'new' | 'needs_attention' | 'balanced' | 'recently_heavy'
  reason: string
  action: string
}

export function preferredNodeKey(subjectId: string) {
  return `${PREFERRED_NODE_PREFIX}${subjectId}`
}

export function getPreferredNode(subjectId: string, subjectNodes: LearningNode[]) {
  let preferredId: string | null = null
  try {
    preferredId = localStorage.getItem(preferredNodeKey(subjectId))
  } catch {
    preferredId = null
  }

  const preferred = preferredId ? subjectNodes.find((node) => node.id === preferredId) : null
  return preferred || subjectNodes.find((node) => node.status !== 'solid') || subjectNodes[0] || null
}

export function setPreferredNode(subjectId: string, nodeId: string | null) {
  try {
    if (nodeId) localStorage.setItem(preferredNodeKey(subjectId), nodeId)
    else localStorage.removeItem(preferredNodeKey(subjectId))
  } catch {
    // Local preference is helpful, but the study flow must keep working without it.
  }
}

export async function ensureWorkspace(userId: string) {
  const subjectRows = STUDY_PRESETS.map((preset, index) => ({
    user_id: userId,
    name: preset.name,
    slug: preset.slug,
    icon: preset.icon,
    sort_order: index,
    attention_weight: preset.attentionWeight,
    recommended_gap_days: preset.gapDays,
    learning_phase: preset.phase,
    is_active: true,
  }))

  const { error: subjectUpsertError } = await supabase
    .from('subjects')
    .upsert(subjectRows, { onConflict: 'user_id,slug', ignoreDuplicates: true })

  if (subjectUpsertError) throw subjectUpsertError

  const { data: subjects, error: subjectError } = await supabase
    .from('subjects')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('sort_order')

  if (subjectError) throw subjectError

  for (const preset of STUDY_PRESETS) {
    const subject = (subjects || []).find((item) => item.slug === preset.slug)
    if (!subject) continue

    const { data: existingGoal, error: goalLookupError } = await supabase
      .from('goals')
      .select('*')
      .eq('user_id', userId)
      .eq('subject_id', subject.id)
      .eq('title', preset.goalTitle)
      .maybeSingle()

    if (goalLookupError) throw goalLookupError

    if (!existingGoal) {
      const { error: goalError } = await supabase.from('goals').insert({
        user_id: userId,
        subject_id: subject.id,
        title: preset.goalTitle,
        description: preset.goalDescription,
        status: 'active',
      })
      if (goalError) throw goalError
    }

    const topicRows = preset.topics.map(([name, priority]) => ({
      user_id: userId,
      subject_id: subject.id,
      name,
      priority,
    }))
    const { error: topicError } = await supabase
      .from('topics')
      .upsert(topicRows, { onConflict: 'user_id,subject_id,name' })
    if (topicError) throw topicError

    const nodeRows = preset.roadmap.map(([title, nodeKind, description, importance], index) => ({
      user_id: userId,
      subject_id: subject.id,
      title,
      description,
      node_kind: nodeKind,
      sort_order: index,
      importance,
    }))

    const { error: nodeError } = await supabase
      .from('learning_nodes')
      .upsert(nodeRows, { onConflict: 'user_id,subject_id,title' })
    if (nodeError) throw nodeError
  }

  const { data: savingsGoal, error: savingsLookupError } = await supabase
    .from('savings_goals')
    .select('id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  if (savingsLookupError) throw savingsLookupError

  if (!savingsGoal) {
    const { error: savingsError } = await supabase.from('savings_goals').insert({
      user_id: userId,
      title: 'Переезд в Японию',
      target_amount_jpy: 2400000,
      is_active: true,
    })
    if (savingsError) throw savingsError
  }
}

export async function loadNavigationData(userId: string, windowDays = 28) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - windowDays)

  const [subjectResult, nodeResult, logResult, goalResult] = await Promise.all([
    supabase.from('subjects').select('*').eq('user_id', userId).eq('is_active', true).order('sort_order'),
    supabase.from('learning_nodes').select('*').eq('user_id', userId).order('sort_order'),
    supabase.from('study_logs').select('*').eq('user_id', userId).gte('occurred_at', cutoff.toISOString()).order('occurred_at', { ascending: false }),
    supabase.from('goals').select('*').eq('user_id', userId).eq('status', 'active'),
  ])

  if (subjectResult.error) throw subjectResult.error
  if (nodeResult.error) throw nodeResult.error
  if (logResult.error) throw logResult.error
  if (goalResult.error) throw goalResult.error

  const subjects = (subjectResult.data || []) as Subject[]
  const allNodes = (nodeResult.data || []) as LearningNode[]

  // Old, generalized roadmap rows are kept in the database so historical logs do not break,
  // but the live UI only shows nodes that exist in the current preset.
  const allowedTitlesBySubjectId = new Map<string, Set<string>>()
  for (const subject of subjects) {
    const preset = STUDY_PRESETS.find((item) => item.slug === subject.slug)
    if (!preset) continue
    allowedTitlesBySubjectId.set(subject.id, new Set(preset.roadmap.map(([title]) => title)))
  }

  const nodes = allNodes.filter((node) => {
    const allowed = allowedTitlesBySubjectId.get(node.subject_id)
    return !allowed || allowed.has(node.title)
  })

  return {
    subjects,
    nodes,
    logs: (logResult.data || []) as StudyLog[],
    goals: (goalResult.data || []) as Goal[],
  }
}

function nextAction(node: LearningNode | null) {
  if (!node) return 'Маршрут закрыт: бери смешанную практику или пробник.'

  if (node.status === 'not_started') return `Разобрать: ${node.title}.`
  if (node.status === 'learning') return `Продолжить: ${node.title}.`
  if (node.status === 'assisted') return `Попробовать без подсказки: ${node.title}.`
  if (node.status === 'independent') return `Проверить и закрепить: ${node.title}.`
  return `Повторить или выбрать другую часть вместо ${node.title}.`
}

export function buildAttentionCards(subjects: Subject[], nodes: LearningNode[], logs: StudyLog[]): AttentionCard[] {
  const totalMinutes = logs.reduce((sum, log) => sum + Number(log.minutes || 0), 0)
  const totalWeight = subjects.reduce((sum, subject) => sum + Number(subject.attention_weight || 1), 0) || 1

  const cards = subjects.map((subject) => {
    const subjectLogs = logs.filter((log) => log.subject_id === subject.id)
    const minutes = subjectLogs.reduce((sum, log) => sum + Number(log.minutes || 0), 0)
    const share = totalMinutes ? minutes / totalMinutes : 0
    const targetShare = Number(subject.attention_weight || 1) / totalWeight
    const latest = subjectLogs[0]?.occurred_at || null
    const gapDays = Math.max(1, Number(subject.recommended_gap_days || 7))
    const daysSinceLast = latest ? daysSince(latest) : null
    const subjectNodes = nodes.filter((node) => node.subject_id === subject.id).sort((a, b) => a.sort_order - b.sort_order)
    const automaticNode = subjectNodes.find((node) => node.status !== 'solid') || subjectNodes[0] || null

    const underAttention = totalMinutes
      ? Math.max(0, targetShare - share) / Math.max(targetShare, 0.01)
      : 0.7
    const staleness = daysSinceLast === null ? 1.7 : Math.min(daysSinceLast / gapDays, 2.5)
    const learningNeed = !automaticNode
      ? 0.1
      : automaticNode.status === 'not_started'
        ? 0.7
        : automaticNode.status === 'learning'
          ? 0.9
          : automaticNode.status === 'assisted'
            ? 0.7
            : 0.35
    const recentlyHeavy = totalMinutes >= 120 && share > targetShare * 1.45
    const score = underAttention * 2 + staleness + learningNeed + Number(subject.attention_weight) * 0.08 - (recentlyHeavy ? 1.7 : 0)

    let state: AttentionCard['state'] = 'balanced'
    let reason = 'За последние недели внимание выглядит достаточно ровно.'

    if (!totalMinutes || daysSinceLast === null) {
      state = 'new'
      reason = 'Пока мало истории. Michi ещё собирает картину твоей подготовки.'
    } else if (recentlyHeavy) {
      state = 'recently_heavy'
      reason = `За 28 дней сюда ушло ${Math.round(share * 100)}% учебного времени — можно спокойно переключиться.`
    } else if (daysSinceLast >= gapDays || share < targetShare * 0.65) {
      state = 'needs_attention'
      reason = daysSinceLast >= gapDays
        ? `Последнее занятие было ${daysSinceLast} дн. назад.`
        : 'За 28 дней этому направлению досталось заметно меньше внимания, чем остальным важным целям.'
    }

    const card = {
      subject,
      minutes,
      share,
      targetShare,
      daysSinceLast,
      score,
      state,
      reason,
      get currentNode() {
        return getPreferredNode(subject.id, subjectNodes)
      },
      get action() {
        return nextAction(getPreferredNode(subject.id, subjectNodes))
      },
    } satisfies AttentionCard

    return card
  })

  return cards.sort((a, b) => b.score - a.score)
}
