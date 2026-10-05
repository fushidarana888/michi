import type { AnkiCardRow, AnkiReviewRow } from './anki'

export type CardDifficultyRow = {
  card: AnkiCardRow
  recentCount: number
  again: number
  hard: number
  good: number
  easy: number
  troubleCount: number
  troubleDays: number
  lapseRate: number
  recentErrorRate: number
  score: number
}

export type AnkiPeriodSummary = {
  reviews: number
  unique: number
  newCards: number
  again: number
  hard: number
  good: number
  easy: number
  durationMs: number
  againRate: number
  troubleRate: number
  avgAnswerMs: number
}

export type AnkiDailyPoint = {
  key: string
  label: string
  reviews: number
  unique: number
  newCards: number
  again: number
  hard: number
  durationMs: number
}

function localDateKey(value: string | number | Date) {
  const date = value instanceof Date ? value : new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))
  return sorted[index]
}

export function buildCardDifficulty(cards: AnkiCardRow[], reviews: AnkiReviewRow[]) {
  const byCard = new Map<number, AnkiReviewRow[]>()
  for (const review of reviews) {
    const list = byCard.get(review.anki_card_id) || []
    list.push(review)
    byCard.set(review.anki_card_id, list)
  }

  return cards
    .filter((card) => card.reps > 0)
    .map((card): CardDifficultyRow => {
      const recent = byCard.get(card.anki_card_id) || []
      const again = recent.filter((review) => review.ease === 1).length
      const hard = recent.filter((review) => review.ease === 2).length
      const good = recent.filter((review) => review.ease === 3).length
      const easy = recent.filter((review) => review.ease === 4).length
      const troublesome = recent.filter((review) => review.ease === 1 || review.ease === 2)
      const troubleCount = troublesome.length
      const troubleDays = new Set(troublesome.map((review) => localDateKey(review.reviewed_at))).size
      const recentErrorRate = recent.length ? (again + hard * 0.45) / recent.length : 0
      const lapseRate = card.reps ? card.lapses / card.reps : 0
      const evidence = Math.min(1, recent.length / 8)
      const score = recent.length
        ? recentErrorRate * (0.45 + evidence * 0.25) + lapseRate * 0.3
        : lapseRate * 0.65
      return { card, recentCount: recent.length, again, hard, good, easy, troubleCount, troubleDays, lapseRate, recentErrorRate, score }
    })
    .sort((a, b) => b.score - a.score || b.again - a.again || b.card.lapses - a.card.lapses)
}

export function pickDifficultCards(rows: CardDifficultyRow[]) {
  const candidates = rows.filter((row) => row.recentCount >= 5 || row.card.reps >= 7 || row.card.lapses >= 2)
  const relativeFloor = Math.max(0.32, percentile(candidates.map((row) => row.score), 0.82))

  return rows.filter((row) => {
    // «Тяжёлая» = устойчивая проблема. Раннее обучение с одной-двумя ошибками сюда не попадает.
    const enoughHistory = row.recentCount >= 5 || row.card.reps >= 7 || row.card.lapses >= 2
    const repeatedAgain = enoughHistory && row.again >= 2 && row.recentCount >= 5 && (row.troubleDays >= 2 || row.card.reps >= 8)
    const repeatedTrouble = enoughHistory && row.troubleCount >= 3 && row.recentCount >= 6 && row.recentErrorRate >= 0.38
    const troubleAcrossDays = row.troubleDays >= 2 && row.troubleCount >= 3 && row.recentCount >= 5
    const repeatedRelearning = row.card.reps >= 7 && row.card.lapses >= 2 && row.lapseRate >= 0.1
    const relativeOutlier = row.recentCount >= 8 && row.troubleCount >= 3 && row.score >= relativeFloor
    return repeatedAgain || repeatedTrouble || troubleAcrossDays || repeatedRelearning || relativeOutlier
  })
}

export function pickUnsettledCards(rows: CardDifficultyRow[], difficult: CardDifficultyRow[]) {
  const difficultIds = new Set(difficult.map((row) => row.card.anki_card_id))
  return rows.filter((row) => {
    if (difficultIds.has(row.card.anki_card_id) || row.troubleCount === 0) return false
    const young = row.card.reps <= 6 || row.recentCount <= 6
    const sparseEvidence = row.recentCount <= 5 && row.troubleCount <= 2
    return young || sparseEvidence
  })
}

export function pickStrongCards(rows: CardDifficultyRow[]) {
  return rows
    .filter((row) => row.card.reps >= 4 && row.card.interval_days >= 10 && row.again === 0 && row.card.lapses <= 1 && row.score < 0.18)
    .sort((a, b) => b.card.interval_days - a.card.interval_days || b.card.reps - a.card.reps)
}

export function difficultySeverity(row: CardDifficultyRow) {
  if (row.again >= 4 || row.troubleDays >= 3 || row.card.lapses >= 4 || row.score >= 0.68) return 'очень тяжело'
  if (row.again >= 2 || row.troubleDays >= 2 || row.card.lapses >= 2 || row.score >= 0.45) return 'тяжело'
  return 'устойчивая проблема'
}

export function periodSummary(reviews: AnkiReviewRow[], cards: AnkiCardRow[], days: number, offsetDays = 0): AnkiPeriodSummary {
  const now = Date.now()
  const end = now - offsetDays * 86_400_000
  const start = end - days * 86_400_000
  const period = reviews.filter((review) => {
    const time = new Date(review.reviewed_at).getTime()
    return time >= start && time < end
  })
  const unique = new Set(period.map((review) => review.anki_card_id)).size
  const newCards = cards.filter((card) => {
    if (!card.first_reviewed_at) return false
    const time = new Date(card.first_reviewed_at).getTime()
    return time >= start && time < end
  }).length
  const again = period.filter((review) => review.ease === 1).length
  const hard = period.filter((review) => review.ease === 2).length
  const good = period.filter((review) => review.ease === 3).length
  const easy = period.filter((review) => review.ease === 4).length
  const durationMs = period.reduce((sum, review) => sum + Number(review.duration_ms || 0), 0)
  return {
    reviews: period.length,
    unique,
    newCards,
    again,
    hard,
    good,
    easy,
    durationMs,
    againRate: period.length ? again / period.length : 0,
    troubleRate: period.length ? (again + hard) / period.length : 0,
    avgAnswerMs: period.length ? durationMs / period.length : 0,
  }
}

export function dailySeries(reviews: AnkiReviewRow[], cards: AnkiCardRow[], days = 30): AnkiDailyPoint[] {
  const byDay = new Map<string, AnkiReviewRow[]>()
  for (const review of reviews) {
    const key = localDateKey(review.reviewed_at)
    const list = byDay.get(key) || []
    list.push(review)
    byDay.set(key, list)
  }

  const firstByDay = new Map<string, number>()
  for (const card of cards) {
    if (!card.first_reviewed_at) continue
    const key = localDateKey(card.first_reviewed_at)
    firstByDay.set(key, (firstByDay.get(key) || 0) + 1)
  }

  const result: AnkiDailyPoint[] = []
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date()
    date.setHours(12, 0, 0, 0)
    date.setDate(date.getDate() - offset)
    const key = localDateKey(date)
    const rows = byDay.get(key) || []
    result.push({
      key,
      label: new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(date),
      reviews: rows.length,
      unique: new Set(rows.map((row) => row.anki_card_id)).size,
      newCards: firstByDay.get(key) || 0,
      again: rows.filter((row) => row.ease === 1).length,
      hard: rows.filter((row) => row.ease === 2).length,
      durationMs: rows.reduce((sum, row) => sum + Number(row.duration_ms || 0), 0),
    })
  }
  return result
}
