import { STUDY_PRESETS } from '../data/presets'
import type { Goal, LearningNode, StudyLog, Subject } from '../types'
import { daysSince, localDateKey } from './date'
import { supabase } from './supabase'

const PREFERRED_NODE_PREFIX = 'michi-preferred-node:'
const ANKI_REVIEW_ATTENTION_WEIGHT = 0.3

type AnkiConnectionSnapshot = {
  deck_name: string | null
}

type AnkiCardSnapshot = {
  anki_card_id: number
  deck_name: string
  first_reviewed_at: string | null
}

type AnkiReviewSnapshot = {
  review_id: number
  anki_card_id: number
  reviewed_at: string
  duration_ms: number
}

type AnkiDayBucket = {
  newCards: Set<number>
  newAnswers: number
  newDurationMs: number
  newLatestAt: string | null
  reviewCards: Set<number>
  reviewAnswers: number
  reviewDurationMs: number
  reviewLatestAt: string | null
}

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

function laterIso(current: string | null, candidate: string) {
  if (!current) return candidate
  return new Date(candidate).getTime() > new Date(current).getTime() ? candidate : current
}

function ankiMinutes(durationMs: number, answerCount: number) {
  if (!answerCount) return 0
  return Math.max(1, Math.round(Math.max(0, durationMs) / 60_000))
}

function synthesizeAnkiStudyLogs(
  userId: string,
  subjects: Subject[],
  nodes: LearningNode[],
  connection: AnkiConnectionSnapshot | null,
  cards: AnkiCardSnapshot[],
  reviews: AnkiReviewSnapshot[],
): StudyLog[] {
  const japanese = subjects.find((subject) => subject.slug === 'japanese')
  const selectedDeck = connection?.deck_name
  if (!japanese || !selectedDeck || !reviews.length) return []

  const deckCards = cards.filter((card) => card.deck_name === selectedDeck)
  if (!deckCards.length) return []

  const japaneseNodes = nodes
    .filter((node) => node.subject_id === japanese.id)
    .sort((a, b) => a.sort_order - b.sort_order)
  const lexicalNode = japaneseNodes.find((node) => /лексик/i.test(node.title) && node.status !== 'solid')
    || japaneseNodes.find((node) => /лексик/i.test(node.title))
    || null

  const firstDayByCard = new Map<number, string>()
  const allowedCardIds = new Set<number>()
  for (const card of deckCards) {
    const cardId = Number(card.anki_card_id)
    allowedCardIds.add(cardId)
    if (card.first_reviewed_at) firstDayByCard.set(cardId, localDateKey(new Date(card.first_reviewed_at)))
  }

  const byDay = new Map<string, AnkiDayBucket>()
  for (const review of reviews) {
    const cardId = Number(review.anki_card_id)
    if (!allowedCardIds.has(cardId)) continue

    const day = localDateKey(new Date(review.reviewed_at))
    const bucket = byDay.get(day) || {
      newCards: new Set<number>(),
      newAnswers: 0,
      newDurationMs: 0,
      newLatestAt: null,
      reviewCards: new Set<number>(),
      reviewAnswers: 0,
      reviewDurationMs: 0,
      reviewLatestAt: null,
    }
    const isFirstLearningDay = firstDayByCard.get(cardId) === day

    if (isFirstLearningDay) {
      bucket.newCards.add(cardId)
      bucket.newAnswers += 1
      bucket.newDurationMs += Math.max(0, Number(review.duration_ms || 0))
      bucket.newLatestAt = laterIso(bucket.newLatestAt, review.reviewed_at)
    } else {
      bucket.reviewCards.add(cardId)
      bucket.reviewAnswers += 1
      bucket.reviewDurationMs += Math.max(0, Number(review.duration_ms || 0))
      bucket.reviewLatestAt = laterIso(bucket.reviewLatestAt, review.reviewed_at)
    }
    byDay.set(day, bucket)
  }

  const logs: StudyLog[] = []
  for (const [day, bucket] of byDay) {
    if (bucket.newAnswers > 0) {
      logs.push({
        id: `anki-new-${day}`,
        user_id: userId,
        subject_id: japanese.id,
        learning_node_id: lexicalNode?.id || null,
        minutes: ankiMinutes(bucket.newDurationMs, bucket.newAnswers),
        activity_kind: 'lesson',
        perceived_difficulty: null,
        note: `Anki · новое: ${bucket.newCards.size} карточек · ${bucket.newAnswers} ответов`,
        occurred_at: bucket.newLatestAt || `${day}T12:00:00`,
        source: 'anki_new',
      })
    }

    if (bucket.reviewAnswers > 0) {
      logs.push({
        id: `anki-review-${day}`,
        user_id: userId,
        subject_id: japanese.id,
        learning_node_id: lexicalNode?.id || null,
        minutes: ankiMinutes(bucket.reviewDurationMs, bucket.reviewAnswers),
        activity_kind: 'review',
        perceived_difficulty: null,
        note: `Anki · повторение: ${bucket.reviewCards.size} карточек · ${bucket.reviewAnswers} ответов`,
        occurred_at: bucket.reviewLatestAt || `${day}T12:00:00`,
        source: 'anki_review',
      })
    }
  }

  return logs.sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())
}

function recommendationMinutes(log: StudyLog) {
  return Number(log.minutes || 0) * (log.source === 'anki_review' ? ANKI_REVIEW_ATTENTION_WEIGHT : 1)
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
  const cutoffIso = cutoff.toISOString()

  const [subjectResult, nodeResult, logResult, goalResult, ankiConnectionResult, ankiCardResult, ankiReviewResult] = await Promise.all([
    supabase.from('subjects').select('*').eq('user_id', userId).eq('is_active', true).order('sort_order'),
    supabase.from('learning_nodes').select('*').eq('user_id', userId).order('sort_order'),
    supabase.from('study_logs').select('*').eq('user_id', userId).gte('occurred_at', cutoffIso).order('occurred_at', { ascending: false }),
    supabase.from('goals').select('*').eq('user_id', userId).eq('status', 'active'),
    supabase.from('anki_connections').select('deck_name').eq('user_id', userId).maybeSingle(),
    supabase.from('anki_cards').select('anki_card_id,deck_name,first_reviewed_at').eq('user_id', userId),
    supabase.from('anki_reviews').select('review_id,anki_card_id,reviewed_at,duration_ms').eq('user_id', userId).gte('reviewed_at', cutoffIso).order('reviewed_at', { ascending: false }),
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

  // Anki is optional: a problem with its analytics must never break the normal Michi navigator.
  const ankiLogs = ankiConnectionResult.error || ankiCardResult.error || ankiReviewResult.error
    ? []
    : synthesizeAnkiStudyLogs(
        userId,
        subjects,
        nodes,
        (ankiConnectionResult.data || null) as AnkiConnectionSnapshot | null,
        (ankiCardResult.data || []) as AnkiCardSnapshot[],
        (ankiReviewResult.data || []) as AnkiReviewSnapshot[],
      )

  const logs = [
    ...((logResult.data || []) as StudyLog[]),
    ...ankiLogs,
  ].sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())

  return {
    subjects,
    nodes,
    logs,
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
  const totalRecommendationMinutes = logs.reduce((sum, log) => sum + recommendationMinutes(log), 0)
  const totalWeight = subjects.reduce((sum, subject) => sum + Number(subject.attention_weight || 1), 0) || 1

  const cards = subjects.map((subject) => {
    const subjectLogs = logs.filter((log) => log.subject_id === subject.id)
    const minutes = subjectLogs.reduce((sum, log) => sum + Number(log.minutes || 0), 0)
    const recommendationTotal = subjectLogs.reduce((sum, log) => sum + recommendationMinutes(log), 0)
    const share = totalMinutes ? minutes / totalMinutes : 0
    const recommendationShare = totalRecommendationMinutes ? recommendationTotal / totalRecommendationMinutes : 0
    const targetShare = Number(subject.attention_weight || 1) / totalWeight
    const meaningfulLogs = subjectLogs.filter((log) => log.source !== 'anki_review')
    const latestMeaningful = meaningfulLogs[0]?.occurred_at || null
    const hasAnkiReviews = subjectLogs.some((log) => log.source === 'anki_review')
    const gapDays = Math.max(1, Number(subject.recommended_gap_days || 7))
    const daysSinceLast = latestMeaningful ? daysSince(latestMeaningful) : null
    const subjectNodes = nodes.filter((node) => node.subject_id === subject.id).sort((a, b) => a.sort_order - b.sort_order)
    const automaticNode = subjectNodes.find((node) => node.status !== 'solid') || subjectNodes[0] || null

    const underAttention = totalRecommendationMinutes
      ? Math.max(0, targetShare - recommendationShare) / Math.max(targetShare, 0.01)
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
    const recentlyHeavy = totalRecommendationMinutes >= 120 && recommendationShare > targetShare * 1.45
    const score = underAttention * 2 + staleness + learningNeed + Number(subject.attention_weight) * 0.08 - (recentlyHeavy ? 1.7 : 0)

    let state: AttentionCard['state'] = 'balanced'
    let reason = 'За последние недели внимание выглядит достаточно ровно.'

    if ((!totalMinutes || daysSinceLast === null) && !(subject.slug === 'japanese' && hasAnkiReviews)) {
      state = 'new'
      reason = 'Пока мало истории. Michi ещё собирает картину твоей подготовки.'
    } else if (subject.slug === 'japanese' && hasAnkiReviews && daysSinceLast === null) {
      state = 'needs_attention'
      reason = 'Повторы Anki учтены, но нового материала пока не было: повторение поддерживает память, а не заменяет движение вперёд.'
    } else if (recentlyHeavy) {
      state = 'recently_heavy'
      reason = `За 28 дней сюда ушло ${Math.round(share * 100)}% фактического учебного времени — можно спокойно переключиться.`
    } else if ((daysSinceLast ?? 999) >= gapDays || recommendationShare < targetShare * 0.65) {
      state = 'needs_attention'
      if (subject.slug === 'japanese' && hasAnkiReviews && (daysSinceLast ?? 999) >= gapDays) {
        reason = `Повторы Anki идут в зачёт, но новое по японскому было ${daysSinceLast ?? 'давно'} дн. назад. Пора добавить новый материал.`
      } else {
        reason = (daysSinceLast ?? 999) >= gapDays
          ? `Последнее содержательное занятие было ${daysSinceLast} дн. назад.`
          : 'За 28 дней этому направлению досталось заметно меньше внимания, чем остальным важным целям.'
      }
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
