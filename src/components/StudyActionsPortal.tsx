import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, Clock3, Play, Square, X } from 'lucide-react'
import { buildAttentionCards, loadNavigationData } from '../lib/navigation'
import { supabase } from '../lib/supabase'
import type { LearningNode } from '../types'

type ActiveStudy = {
  startedAt: number
  userId: string
  subjectId: string
  subjectName: string
  nodeId: string | null
  nodeStatus: LearningNode['status'] | null
  plannedMinutes: number
}

type ReviewStudy = Omit<ActiveStudy, 'startedAt'> & {
  minutes: number
  difficulty: number | null
}

const STORAGE_KEY = 'michi-active-study'

function readStoredStudy(): ActiveStudy | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) as ActiveStudy : null
  } catch {
    return null
  }
}

function plannedMinutesFromCard(card: HTMLElement) {
  const meta = [...card.querySelectorAll('.recommendation-meta span')]
    .map((item) => item.textContent || '')
    .find((text) => text.includes('сейчас:'))
  const match = meta?.match(/сейчас:\s*(\d+)/i)
  if (match) return Math.max(1, Number(match[1]))

  const activeButton = [...card.querySelectorAll('.duration-picker button')]
    .find((button) => button.classList.contains('active'))
  const buttonMatch = activeButton?.textContent?.match(/(\d+)/)
  return buttonMatch ? Math.max(1, Number(buttonMatch[1])) : 30
}

async function resolveCurrentStudy(card: HTMLElement) {
  const { data: sessionData } = await supabase.auth.getSession()
  const userId = sessionData.session?.user.id
  if (!userId) throw new Error('Сессия не найдена')

  const data = await loadNavigationData(userId)
  const cards = buildAttentionCards(data.subjects, data.nodes, data.logs)
  const heading = card.querySelector('h2')?.textContent || ''
  const current = cards.find((item) => heading.includes(item.subject.name)) || cards[0]
  if (!current) throw new Error('Не удалось определить предмет')

  return {
    userId,
    subjectId: current.subject.id,
    subjectName: current.subject.name,
    nodeId: current.currentNode?.id || null,
    nodeStatus: current.currentNode?.status || null,
    plannedMinutes: plannedMinutesFromCard(card),
  }
}

function studyKind(status: LearningNode['status'] | null) {
  return status === 'not_started' || status === 'learning' ? 'theory' : 'practice'
}

export function StudyActionsPortal() {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const [restMode, setRestMode] = useState(false)
  const [active, setActive] = useState<ActiveStudy | null>(() => readStoredStudy())
  const [review, setReview] = useState<ReviewStudy | null>(null)
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    function syncTarget() {
      const card = document.querySelector<HTMLElement>('.recommendation-card')
      setTarget(card)
      setRestMode(Boolean(card?.textContent?.includes('СЕГОДНЯ БЕЗ УЧЁБЫ')))
    }

    syncTarget()
    const observer = new MutationObserver(syncTarget)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    window.addEventListener('hashchange', syncTarget)
    return () => {
      observer.disconnect()
      window.removeEventListener('hashchange', syncTarget)
    }
  }, [])

  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])

  const elapsed = useMemo(() => {
    if (!active) return 0
    return Math.max(0, Math.floor((now - active.startedAt) / 1000))
  }, [active, now])

  async function startStudy() {
    if (!target || busy) return
    setBusy(true)
    setMessage('')
    try {
      const context = await resolveCurrentStudy(target)
      const next: ActiveStudy = { ...context, startedAt: Date.now() }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      setActive(next)
      setReview(null)
      setNow(Date.now())
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось начать занятие')
    } finally {
      setBusy(false)
    }
  }

  async function alreadyDone() {
    if (!target || busy) return
    setBusy(true)
    setMessage('')
    try {
      const context = await resolveCurrentStudy(target)
      setReview({ ...context, minutes: context.plannedMinutes, difficulty: null })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось подготовить запись')
    } finally {
      setBusy(false)
    }
  }

  function finishTimer() {
    if (!active) return
    const actualMinutes = Math.max(1, Math.ceil((Date.now() - active.startedAt) / 60_000))
    setReview({
      userId: active.userId,
      subjectId: active.subjectId,
      subjectName: active.subjectName,
      nodeId: active.nodeId,
      nodeStatus: active.nodeStatus,
      plannedMinutes: active.plannedMinutes,
      minutes: actualMinutes,
      difficulty: null,
    })
    setActive(null)
    localStorage.removeItem(STORAGE_KEY)
  }

  function cancelTimer() {
    setActive(null)
    setReview(null)
    localStorage.removeItem(STORAGE_KEY)
    setMessage('Занятие отменено — в статистику ничего не попало.')
  }

  async function saveReview() {
    if (!review || busy) return
    setBusy(true)
    setMessage('')
    const minutes = Math.max(1, Math.round(Number(review.minutes) || 1))
    const { error } = await supabase.from('study_logs').insert({
      user_id: review.userId,
      subject_id: review.subjectId,
      learning_node_id: review.nodeId,
      minutes,
      activity_kind: studyKind(review.nodeStatus),
      perceived_difficulty: review.difficulty,
      source: 'quick_session',
    })

    if (error) {
      setMessage(error.message)
      setBusy(false)
      return
    }

    setMessage(`Записано: ${review.subjectName}, ${minutes} мин.`)
    setReview(null)
    localStorage.removeItem(STORAGE_KEY)
    setBusy(false)
    window.setTimeout(() => window.location.reload(), 500)
  }

  if (!target || restMode) return null

  const minutes = Math.floor(elapsed / 60)
  const seconds = String(elapsed % 60).padStart(2, '0')

  const content = (
    <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
      {!active && !review && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button className="primary-button" type="button" onClick={() => void startStudy()} disabled={busy}>
              <Play size={17} /> Начать занятие
            </button>
            <button className="secondary-button" type="button" onClick={() => void alreadyDone()} disabled={busy}>
              <CheckCircle2 size={17} /> Уже сделал
            </button>
          </div>
          <p className="muted tiny" style={{ margin: '9px 0 0' }}>
            «Начать» запустит таймер. «Уже сделал» сразу даст записать выбранное время в статистику.
          </p>
        </>
      )}

      {active && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div>
              <p className="eyebrow" style={{ marginBottom: 4 }}>ЗАНЯТИЕ ИДЁТ</p>
              <strong>{active.subjectName}</strong>
            </div>
            <span className="status-badge"><Clock3 size={15} /> {minutes}:{seconds}</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button className="primary-button" type="button" onClick={finishTimer}><Square size={16} /> Готово</button>
            <button className="secondary-button" type="button" onClick={cancelTimer}><X size={16} /> Отменить</button>
          </div>
        </div>
      )}

      {review && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <p className="eyebrow" style={{ marginBottom: 4 }}>ЗАПИСАТЬ ЗАНЯТИЕ</p>
            <strong>{review.subjectName}</strong>
          </div>
          <label style={{ maxWidth: 180 }}>
            <span>Сколько минут реально занимался</span>
            <input type="number" min="1" max="600" value={review.minutes} onChange={(event) => setReview({ ...review, minutes: Number(event.target.value) })} />
          </label>
          <div>
            <span className="muted tiny">Как шло? Необязательно.</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 7 }}>
              {[[1, 'Легко'], [2, 'Нормально'], [3, 'Тяжело'], [4, 'Не понял']] .map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="secondary-button"
                  onClick={() => setReview({ ...review, difficulty: review.difficulty === value ? null : Number(value) })}
                  style={review.difficulty === value ? { borderColor: 'rgba(168,240,208,.5)', color: 'var(--accent)' } : undefined}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button className="primary-button" type="button" onClick={() => void saveReview()} disabled={busy}><CheckCircle2 size={17} /> Сохранить как выполненное</button>
            <button className="secondary-button" type="button" onClick={() => setReview(null)}>Не сохранять</button>
          </div>
        </div>
      )}

      {message && <p className="form-message success" style={{ marginTop: 10 }}>{message}</p>}
    </div>
  )

  return createPortal(content, target)
}
