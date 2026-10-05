import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Sprout } from 'lucide-react'
import { loadAnkiDashboardData, type AnkiCardRow, type AnkiReviewRow } from '../lib/anki'
import { supabase } from '../lib/supabase'
import './AnkiDifficultyListPortal.css'

type DifficultyRow = {
  card: AnkiCardRow
  recentCount: number
  again: number
  hard: number
  troubleCount: number
  troubleDays: number
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
      const troublesome = recent.filter((review) => review.ease === 1 || review.ease === 2)
      const troubleCount = troublesome.length
      const troubleDays = new Set(troublesome.map((review) => review.reviewed_at.slice(0, 10))).size
      const recentErrorRate = recent.length ? (again + hard * 0.45) / recent.length : 0
      const lapseRate = card.reps ? card.lapses / card.reps : 0
      const evidence = Math.min(1, recent.length / 5)
      const score = recent.length
        ? recentErrorRate * (0.5 + evidence * 0.2) + lapseRate * 0.3
        : lapseRate * 0.65
      return { card, recentCount: recent.length, again, hard, troubleCount, troubleDays, lapseRate, recentErrorRate, score }
    })
    .sort((a, b) => b.score - a.score || b.again - a.again || b.card.lapses - a.card.lapses)
}

function pickDifficult(rows: DifficultyRow[]) {
  const withEvidence = rows.filter((row) => row.recentCount >= 3 || row.card.reps >= 6 || row.card.lapses >= 2)
  const scores = withEvidence.map((row) => row.score)
  const relativeFloor = Math.max(0.3, percentile(scores, 0.8))

  return rows.filter((row) => {
    // Один «Снова» среди двух первых показов — это нормальная часть закрепления,
    // а не доказательство того, что карточка тяжёлая.
    const repeatedAgain = row.again >= 2 && row.recentCount >= 3
    const repeatedTrouble = row.troubleCount >= 3 && row.recentCount >= 4 && row.recentErrorRate >= 0.42
    const troubleAcrossDays = row.troubleDays >= 2 && row.troubleCount >= 2 && row.recentCount >= 3
    const repeatedRelearning = row.card.reps >= 6 && row.card.lapses >= 2 && row.lapseRate >= 0.12
    const relativeOutlier = row.recentCount >= 5 && row.troubleCount >= 2 && row.score >= relativeFloor && row.score >= 0.28
    return repeatedAgain || repeatedTrouble || troubleAcrossDays || repeatedRelearning || relativeOutlier
  })
}

function pickUnsettled(rows: DifficultyRow[], difficult: DifficultyRow[]) {
  const difficultIds = new Set(difficult.map((row) => row.card.anki_card_id))
  return rows.filter((row) => {
    if (difficultIds.has(row.card.anki_card_id)) return false
    if (row.troubleCount === 0) return false

    // Здесь как раз живут карточки вида «2 показа, 1 Снова»: материала ещё мало,
    // чтобы ставить ярлык «тяжёлая», но видно, что карточка пока не закрепилась.
    const earlyLearning = row.card.reps <= 4 && row.recentCount <= 4
    const littleEvidence = row.recentCount <= 3 && row.troubleCount >= 1
    return earlyLearning || littleEvidence
  })
}

function severity(row: DifficultyRow) {
  if (row.again >= 4 || row.troubleDays >= 3 || row.score >= 0.68 || row.card.lapses >= 4) return 'очень тяжело'
  if (row.again >= 2 || row.troubleDays >= 2 || row.score >= 0.45 || row.card.lapses >= 2) return 'тяжело'
  return 'устойчивая проблема'
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

function CardSignals({ row, unsettled = false }: { row: DifficultyRow; unsettled?: boolean }) {
  return (
    <article className="anki-adaptive-item" key={row.card.anki_card_id}>
      <div className="anki-adaptive-word">
        <strong>{row.card.question_text || `Карточка ${row.card.anki_card_id}`}</strong>
        {row.card.answer_text && <span>{row.card.answer_text}</span>}
      </div>
      <div className="anki-adaptive-signals">
        {unsettled
          ? <span className="anki-severity anki-unsettled-badge">ещё не закрепилась</span>
          : <span className={`anki-severity severity-${severity(row).replaceAll(' ', '-')}`}>{severity(row)}</span>}
        <span>«Снова» 30д: <b>{row.again}</b></span>
        <span>«Трудно» 30д: <b>{row.hard}</b></span>
        <span>переучиваний: <b>{row.card.lapses}</b></span>
        <span>показов всего: <b>{row.card.reps}</b></span>
      </div>
    </article>
  )
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
  const unsettled = useMemo(() => pickUnsettled(rows, difficult), [rows, difficult])

  if (!target) return null

  return createPortal(
    <div className="anki-adaptive-root">
      <div className="anki-adaptive-title">
        <AlertTriangle size={19} />
        <div>
          <span>Тяжёлые карточки</span>
          <strong>{difficult.length ? `${difficult.length} ${difficult.length === 1 ? 'карточка с устойчивой проблемой' : 'карточек с устойчивой проблемой'}` : 'устойчиво тяжёлых сейчас нет'}</strong>
          <small>«Тяжёлая» теперь означает повторяющуюся проблему: несколько «Снова»/«Трудно» на разных повторениях или повторные возвраты в переучивание. Один промах в начале сюда не попадает.</small>
        </div>
      </div>

      {difficult.length > 0 && (
        <div className="anki-adaptive-list">
          {difficult.map((row) => <CardSignals row={row} key={row.card.anki_card_id} />)}
        </div>
      )}

      {unsettled.length > 0 && (
        <section className="anki-unsettled-section">
          <div className="anki-unsettled-title">
            <Sprout size={18} />
            <div>
              <strong>Ещё не закрепились · {unsettled.length}</strong>
              <small>Здесь мало истории: ошибка уже была, но данных недостаточно, чтобы считать карточку реально тяжёлой.</small>
            </div>
          </div>
          <div className="anki-adaptive-list">
            {unsettled.map((row) => <CardSignals row={row} unsettled key={row.card.anki_card_id} />)}
          </div>
        </section>
      )}

      <p className="anki-lapse-help"><strong>Переучивание</strong> — это то, что Anki называет lapse: карточка уже дошла до обычных повторений, ты нажал «Снова», и Anki вернул её в режим переучивания. Это не то же самое, что все нажатия «Снова»: ошибки во время первого изучения сюда обычно не прибавляются.</p>
    </div>,
    target,
  )
}
