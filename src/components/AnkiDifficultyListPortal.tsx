import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle } from 'lucide-react'
import { loadAnkiDashboardData, type AnkiCardRow, type AnkiReviewRow } from '../lib/anki'
import { supabase } from '../lib/supabase'
import './AnkiDifficultyListPortal.css'

type DifficultyRow = {
  card: AnkiCardRow
  recentCount: number
  again: number
  hard: number
  lapseRate: number
  recentErrorRate: number
  score: number
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))
  return sorted[index]
}

function buildDifficulty(cards: AnkiCardRow[], reviews: AnkiReviewRow[]) {
  const byCard = new Map<number, AnkiReviewRow[]>()
  for (const review of reviews) {
    const list = byCard.get(review.anki_card_id) || []
    list.push(review)
    byCard.set(review.anki_card_id, list)
  }

  return cards
    .filter((card) => card.reps > 0)
    .map((card): DifficultyRow => {
      const recent = byCard.get(card.anki_card_id) || []
      const again = recent.filter((review) => review.ease === 1).length
      const hard = recent.filter((review) => review.ease === 2).length
      const recentErrorRate = recent.length ? (again + hard * 0.45) / recent.length : 0
      const lapseRate = card.reps ? card.lapses / card.reps : 0
      const evidence = Math.min(1, recent.length / 4)
      const score = recent.length
        ? recentErrorRate * (0.55 + evidence * 0.2) + lapseRate * 0.25
        : lapseRate * 0.65
      return { card, recentCount: recent.length, again, hard, lapseRate, recentErrorRate, score }
    })
    .sort((a, b) => b.score - a.score || b.again - a.again || b.card.lapses - a.card.lapses)
}

function pickDifficult(rows: DifficultyRow[]) {
  const withEvidence = rows.filter((row) => row.recentCount >= 2 || row.card.reps >= 5 || row.card.lapses > 0)
  const scores = withEvidence.map((row) => row.score)
  const relativeFloor = Math.max(0.28, percentile(scores, 0.78))

  return rows.filter((row) => {
    const repeatedAgain = row.again >= 2
    const consistentlyHard = row.recentCount >= 2 && row.recentErrorRate >= 0.45
    const repeatedRelearning = row.card.reps >= 5 && row.card.lapses >= 2 && row.lapseRate >= 0.12
    const relativeOutlier = row.recentCount >= 3 && row.score >= relativeFloor && row.score >= 0.24
    return repeatedAgain || consistentlyHard || repeatedRelearning || relativeOutlier
  })
}

function severity(row: DifficultyRow) {
  if (row.again >= 3 || row.score >= 0.62 || row.card.lapses >= 4) return 'очень тяжело'
  if (row.again >= 2 || row.score >= 0.42 || row.card.lapses >= 2) return 'тяжело'
  return 'нестабильно'
}

function harmonizeTerms() {
  const panel = document.querySelector<HTMLElement>('.anki-panel')
  if (!panel) return

  for (const span of panel.querySelectorAll<HTMLElement>('.anki-row-header span')) {
    if (span.textContent?.trim() === 'Срывов') span.textContent = 'Переучиваний'
  }

  for (const small of panel.querySelectorAll<HTMLElement>('.anki-periods small')) {
    const text = small.textContent || ''
    if (text.includes('срывов / возвратов в переучивание')) {
      small.textContent = text.replace('срывов / возвратов в переучивание', 'переучиваний')
    }
  }
}

export function AnkiDifficultyListPortal() {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const [cards, setCards] = useState<AnkiCardRow[]>([])
  const [reviews, setReviews] = useState<AnkiReviewRow[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const syncSignature = useRef('')

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setUserId(data.session?.user.id || null))
  }, [])

  async function reload(id = userId) {
    if (!id) return
    const data = await loadAnkiDashboardData(id)
    setCards(data.cards)
    setReviews(data.reviews)
  }

  useEffect(() => {
    if (!userId) return
    void reload(userId)
  }, [userId])

  useEffect(() => {
    function syncFromPage() {
      const nextTarget = document.querySelector<HTMLElement>('.anki-hardest')
      setTarget(nextTarget)
      harmonizeTerms()

      const lastSync = document.querySelector<HTMLElement>('.anki-actions .tiny')?.textContent || ''
      if (userId && lastSync && lastSync !== syncSignature.current) {
        syncSignature.current = lastSync
        void reload(userId)
      }
    }

    syncFromPage()
    const observer = new MutationObserver(syncFromPage)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    window.addEventListener('hashchange', syncFromPage)
    return () => {
      observer.disconnect()
      window.removeEventListener('hashchange', syncFromPage)
    }
  }, [userId])

  useEffect(() => {
    if (!target) return
    target.classList.add('michi-adaptive-hard-list')
    return () => target.classList.remove('michi-adaptive-hard-list')
  }, [target])

  const rows = useMemo(() => buildDifficulty(cards, reviews), [cards, reviews])
  const difficult = useMemo(() => pickDifficult(rows), [rows])

  if (!target) return null

  return createPortal(
    <div className="anki-adaptive-root">
      <div className="anki-adaptive-title">
        <AlertTriangle size={19} />
        <div>
          <span>Тяжёлые карточки</span>
          <strong>{difficult.length ? `${difficult.length} ${difficult.length === 1 ? 'карточка выделена' : 'карточек выделено'}` : 'явно тяжёлых сейчас нет'}</strong>
          <small>Количество не фиксировано: Michi добавляет карточку только когда ошибки начинают повторяться или она заметно тяжелее остальных.</small>
        </div>
      </div>

      {difficult.length > 0 && (
        <div className="anki-adaptive-list">
          {difficult.map((row) => (
            <article className="anki-adaptive-item" key={row.card.anki_card_id}>
              <div className="anki-adaptive-word">
                <strong>{row.card.question_text || `Карточка ${row.card.anki_card_id}`}</strong>
                {row.card.answer_text && <span>{row.card.answer_text}</span>}
              </div>
              <div className="anki-adaptive-signals">
                <span className={`anki-severity severity-${severity(row).replace(' ', '-')}`}>{severity(row)}</span>
                <span>«Снова» 30д: <b>{row.again}</b></span>
                <span>«Трудно» 30д: <b>{row.hard}</b></span>
                <span>переучиваний: <b>{row.card.lapses}</b></span>
                <span>показов всего: <b>{row.card.reps}</b></span>
              </div>
            </article>
          ))}
        </div>
      )}

      <p className="anki-lapse-help"><strong>Переучивание</strong> — это то, что Anki называет lapse: карточка уже дошла до обычных повторений, ты нажал «Снова», и Anki вернул её в режим переучивания. Это не то же самое, что все нажатия «Снова»: ошибки во время первого изучения сюда обычно не прибавляются.</p>
    </div>,
    target,
  )
}
