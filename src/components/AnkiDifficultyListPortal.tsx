import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Sprout } from 'lucide-react'
import { loadAnkiDashboardData, type AnkiCardRow, type AnkiReviewRow } from '../lib/anki'
import {
  buildCardDifficulty,
  difficultySeverity,
  pickDifficultCards,
  pickUnsettledCards,
  type CardDifficultyRow,
} from '../lib/ankiAnalytics'
import { supabase } from '../lib/supabase'
import './AnkiDifficultyListPortal.css'

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

function CardSignals({ row, unsettled = false }: { row: CardDifficultyRow; unsettled?: boolean }) {
  return (
    <article className="anki-adaptive-item" key={row.card.anki_card_id}>
      <div className="anki-adaptive-word">
        <strong>{row.card.question_text || `Карточка ${row.card.anki_card_id}`}</strong>
        {row.card.answer_text && <span>{row.card.answer_text}</span>}
      </div>
      <div className="anki-adaptive-signals">
        {unsettled
          ? <span className="anki-severity anki-unsettled-badge">ещё не закрепилась</span>
          : <span className={`anki-severity severity-${difficultySeverity(row).replaceAll(' ', '-')}`}>{difficultySeverity(row)}</span>}
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

  const rows = useMemo(() => buildCardDifficulty(cards, reviews), [cards, reviews])
  const difficult = useMemo(() => pickDifficultCards(rows), [rows])
  const unsettled = useMemo(() => pickUnsettledCards(rows, difficult), [rows, difficult])

  if (!target) return null

  return createPortal(
    <div className="anki-adaptive-root">
      <div className="anki-adaptive-title">
        <AlertTriangle size={19} />
        <div>
          <span>Тяжёлые карточки</span>
          <strong>{difficult.length ? `${difficult.length} ${difficult.length === 1 ? 'карточка с устойчивой проблемой' : 'карточек с устойчивой проблемой'}` : 'устойчиво тяжёлых сейчас нет'}</strong>
          <small>Один «Снова» из двух первых показов не делает карточку тяжёлой. Нужна повторяющаяся проблема на достаточном количестве показов или несколько возвратов в переучивание.</small>
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
              <small>Ошибка уже была, но карточка ещё слишком молодая, чтобы делать вывод о реальной сложности.</small>
            </div>
          </div>
          <div className="anki-adaptive-list">
            {unsettled.map((row) => <CardSignals row={row} unsettled key={row.card.anki_card_id} />)}
          </div>
        </section>
      )}

      <p className="anki-lapse-help"><strong>Переучивание</strong> — это lapse в Anki: карточка уже вышла в обычные повторения, затем была забыта и вернулась в режим переучивания. Ошибка во время первого знакомства с карточкой обычно сюда не относится.</p>
    </div>,
    target,
  )
}
