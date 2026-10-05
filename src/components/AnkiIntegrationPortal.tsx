import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, BarChart3, CheckCircle2, RefreshCw, Search, Wifi, WifiOff } from 'lucide-react'
import {
  getAnkiDeckNames,
  getStoredAnkiKeyValue,
  loadAnkiDashboardData,
  requestAnkiPermission,
  saveAnkiDeck,
  setStoredAnkiKey,
  syncAnkiToMichi,
  type AnkiCardRow,
  type AnkiConnectionRow,
  type AnkiReviewRow,
  type AnkiSyncProgress,
} from '../lib/anki'
import { supabase } from '../lib/supabase'
import './AnkiIntegrationPortal.css'

type DashboardData = {
  connection: AnkiConnectionRow | null
  cards: AnkiCardRow[]
  reviews: AnkiReviewRow[]
}

function formatDateTime(value: string | null) {
  if (!value) return 'ещё не было'
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatDuration(ms: number) {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes} мин`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`
}

function periodStats(reviews: AnkiReviewRow[], cards: AnkiCardRow[], days: number) {
  const cutoff = Date.now() - days * 86_400_000
  const period = reviews.filter((review) => new Date(review.reviewed_at).getTime() >= cutoff)
  const unique = new Set(period.map((review) => review.anki_card_id)).size
  const newCards = cards.filter((card) => card.first_reviewed_at && new Date(card.first_reviewed_at).getTime() >= cutoff).length
  const again = period.filter((review) => review.ease === 1).length
  const hard = period.filter((review) => review.ease === 2).length
  const duration = period.reduce((sum, review) => sum + Number(review.duration_ms || 0), 0)
  return {
    reviews: period.length,
    unique,
    newCards,
    again,
    hard,
    duration,
    againRate: period.length ? again / period.length : 0,
  }
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
    .map((card) => {
      const recent = byCard.get(card.anki_card_id) || []
      const again = recent.filter((review) => review.ease === 1).length
      const hard = recent.filter((review) => review.ease === 2).length
      const recentDifficulty = recent.length ? (again + hard * 0.45) / recent.length : 0
      const lifetimeLapseRate = card.reps ? card.lapses / card.reps : 0
      const score = recent.length
        ? recentDifficulty * 0.75 + lifetimeLapseRate * 0.25
        : lifetimeLapseRate * 0.65
      return { card, recentCount: recent.length, again, hard, score }
    })
    .sort((a, b) => b.score - a.score || b.card.lapses - a.card.lapses || b.card.reps - a.card.reps)
}

function Stat({ value, label, detail }: { value: string; label: string; detail?: string }) {
  return <div className="anki-stat"><strong>{value}</strong><span>{label}</span>{detail && <small>{detail}</small>}</div>
}

export function AnkiIntegrationPortal() {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const [visible, setVisible] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [data, setData] = useState<DashboardData>({ connection: null, cards: [], reviews: [] })
  const [decks, setDecks] = useState<string[]>([])
  const [deckName, setDeckName] = useState('')
  const [apiKey, setApiKey] = useState(() => getStoredAnkiKeyValue())
  const [needsApiKey, setNeedsApiKey] = useState(false)
  const [liveConnected, setLiveConnected] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<AnkiSyncProgress | null>(null)
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [showCount, setShowCount] = useState(20)

  useEffect(() => {
    void supabase.auth.getSession().then(({ data: sessionData }) => setUserId(sessionData.session?.user.id || null))
  }, [])

  useEffect(() => {
    function syncTarget() {
      const card = document.querySelector<HTMLElement>('.recommendation-card')
      const heading = card?.querySelector('h2')?.textContent || ''
      setTarget(card)
      setVisible(Boolean(card && heading.includes('Японский') && !card.textContent?.includes('СЕГОДНЯ БЕЗ УЧЁБЫ')))
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

  async function reloadDashboard(id = userId) {
    if (!id) return
    const next = await loadAnkiDashboardData(id)
    setData(next)
    if (next.connection?.deck_name) setDeckName(next.connection.deck_name)
  }

  useEffect(() => {
    if (!userId || !visible) return
    void reloadDashboard(userId).catch((error) => setMessage(error instanceof Error ? error.message : 'Не удалось загрузить статистику Anki'))
  }, [userId, visible])

  const week = useMemo(() => periodStats(data.reviews, data.cards, 7), [data])
  const month = useMemo(() => periodStats(data.reviews, data.cards, 30), [data])
  const difficulty = useMemo(() => buildDifficulty(data.cards, data.reviews), [data])
  const hardest = difficulty[0] || null
  const totalReviews = data.cards.reduce((sum, card) => sum + Number(card.reps || 0), 0)
  const totalLapses = data.cards.reduce((sum, card) => sum + Number(card.lapses || 0), 0)
  const filteredCards = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    const rows = normalized
      ? difficulty.filter(({ card }) => `${card.question_text || ''} ${card.answer_text || ''}`.toLowerCase().includes(normalized))
      : difficulty
    return rows.slice(0, showCount)
  }, [difficulty, search, showCount])

  async function connect() {
    if (!userId || busy) return
    setBusy(true)
    setMessage('')
    try {
      const permission = await requestAnkiPermission()
      if (permission.permission !== 'granted') {
        setLiveConnected(false)
        setMessage('Anki не дал доступ. На компьютере должно появиться окно AnkiConnect — разреши доступ Michi и попробуй ещё раз.')
        return
      }
      setNeedsApiKey(Boolean(permission.requireApiKey))
      if (permission.requireApiKey && !getStoredAnkiKeyValue()) {
        setLiveConnected(false)
        setMessage('В AnkiConnect включён API-ключ. Введи его ниже: Michi сохранит его только в этом браузере, не в Supabase.')
        return
      }
      const names = await getAnkiDeckNames()
      setDecks(names)
      setLiveConnected(true)
      const existing = data.connection?.deck_name
      const japaneseGuess = names.find((name) => /япон|japan|nihon|n5|n4|日本/i.test(name))
      const chosen = existing && names.includes(existing) ? existing : japaneseGuess || names[0] || ''
      setDeckName(chosen)
      if (chosen) await saveAnkiDeck(userId, chosen)
      setMessage(names.length ? 'Anki подключён. Выбери колоду и запусти синхронизацию.' : 'Anki подключён, но колод пока не найдено.')
      await reloadDashboard(userId)
    } catch (error) {
      setLiveConnected(false)
      setMessage(error instanceof Error ? error.message : 'Не удалось подключиться к Anki')
    } finally {
      setBusy(false)
    }
  }

  async function useApiKey() {
    setStoredAnkiKey(apiKey)
    setNeedsApiKey(false)
    await connect()
  }

  async function chooseDeck(value: string) {
    setDeckName(value)
    if (!userId || !value) return
    try {
      await saveAnkiDeck(userId, value)
      await reloadDashboard(userId)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось сохранить колоду')
    }
  }

  async function syncNow() {
    if (!userId || !deckName || busy) return
    setBusy(true)
    setMessage('')
    setProgress(null)
    try {
      const result = await syncAnkiToMichi(userId, deckName, setProgress)
      setLiveConnected(true)
      setMessage(`Готово: ${result.cardCount} карточек, новых записей повторения — ${result.newReviewCount}.`)
      await reloadDashboard(userId)
    } catch (error) {
      setLiveConnected(false)
      setMessage(error instanceof Error ? error.message : 'Синхронизация не удалась')
    } finally {
      setBusy(false)
      window.setTimeout(() => setProgress(null), 1200)
    }
  }

  if (!target || !visible || !userId) return null

  const content = (
    <section className="anki-panel">
      <div className="anki-head">
        <div>
          <p className="eyebrow">ANKI · ЯПОНСКИЙ</p>
          <h3>Карточки учитываются отдельно от обычного маршрута</h3>
          <p className="muted">Anki остаётся главным для SRS, а Michi хранит снимок прогресса и историю повторений. Поэтому статистика видна и с телефона после синхронизации на ПК.</p>
        </div>
        <div className={`anki-live-badge ${liveConnected ? 'online' : ''}`}>
          {liveConnected ? <Wifi size={16} /> : <WifiOff size={16} />}
          <span>{liveConnected ? 'Anki на связи' : data.connection?.last_sync_at ? 'данные из Michi' : 'не подключено'}</span>
        </div>
      </div>

      {data.connection?.last_sync_at && (
        <div className="anki-overview-grid">
          <Stat value={String(week.reviews)} label="ответов за 7 дней" detail={`${week.unique} разных · ${week.newCards} новых`} />
          <Stat value={String(month.reviews)} label="ответов за 30 дней" detail={`${month.unique} разных · ${month.newCards} новых`} />
          <Stat value={String(data.cards.length)} label="карточек в колоде" detail={`${totalReviews.toLocaleString('ru-RU')} показов всего`} />
          <Stat value={formatDuration(month.duration)} label="время ответов за 30 дней" detail={`${Math.round(month.againRate * 100)}% ответов «Снова»`} />
        </div>
      )}

      {hardest && (
        <div className="anki-hardest">
          <AlertTriangle size={19} />
          <div>
            <span>Сейчас тяжелее всего</span>
            <strong>{hardest.card.question_text || `Карточка ${hardest.card.anki_card_id}`}</strong>
            <small>{hardest.card.reps} повторений всего · {hardest.card.lapses} срывов · «Снова» за 30 дней: {hardest.again}</small>
          </div>
        </div>
      )}

      <div className="anki-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void connect()}>
          <Wifi size={17} /> {liveConnected ? 'Проверить Anki' : 'Подключить Anki'}
        </button>
        {(liveConnected || data.connection?.deck_name) && (
          <label className="anki-deck-select">
            <span>Колода</span>
            {decks.length ? (
              <select value={deckName} onChange={(event) => void chooseDeck(event.target.value)}>
                {decks.map((deck) => <option key={deck} value={deck}>{deck}</option>)}
              </select>
            ) : <strong>{deckName || data.connection?.deck_name || 'не выбрана'}</strong>}
          </label>
        )}
        <button type="button" className="primary-button" disabled={busy || !deckName} onClick={() => void syncNow()}>
          <RefreshCw size={17} className={busy ? 'anki-spin' : ''} /> Синхронизировать
        </button>
        {data.connection?.last_sync_at && <span className="muted tiny">последняя: {formatDateTime(data.connection.last_sync_at)}</span>}
      </div>

      {needsApiKey && (
        <div className="anki-key-row">
          <label><span>API-ключ AnkiConnect</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></label>
          <button type="button" className="secondary-button" onClick={() => void useApiKey()}>Использовать</button>
          <small>Ключ хранится только в localStorage этого браузера и не отправляется в Supabase.</small>
        </div>
      )}

      {progress && (
        <div className="anki-progress">
          <div><span>{progress.text}</span><small>{progress.total > 1 ? `${progress.current}/${progress.total}` : ''}</small></div>
          <div className="bar-track"><span style={{ width: `${progress.total ? Math.min(100, progress.current / progress.total * 100) : 10}%` }} /></div>
        </div>
      )}

      {message && <p className="anki-message"><CheckCircle2 size={16} /> {message}</p>}

      {!data.connection?.last_sync_at && (
        <div className="anki-first-setup">
          <strong>Первое подключение делается на ПК.</strong>
          <span>Установи AnkiConnect (код дополнения 2055492159), перезапусти Anki, оставь его открытым и нажми «Подключить Anki». Anki попросит разрешить сайт Michi.</span>
        </div>
      )}

      {data.connection?.last_sync_at && (
        <>
          <button type="button" className="anki-expand" onClick={() => setExpanded((value) => !value)}>
            <BarChart3 size={17} /> {expanded ? 'Скрыть подробности' : 'Подробная статистика карточек'}
          </button>

          {expanded && (
            <div className="anki-details">
              <div className="anki-periods">
                <article>
                  <span>7 дней</span>
                  <strong>{week.reviews} ответов</strong>
                  <small>{week.unique} уникальных · {week.newCards} впервые изученных · {week.again} «Снова» · {week.hard} «Трудно» · {formatDuration(week.duration)}</small>
                </article>
                <article>
                  <span>30 дней</span>
                  <strong>{month.reviews} ответов</strong>
                  <small>{month.unique} уникальных · {month.newCards} впервые изученных · {month.again} «Снова» · {month.hard} «Трудно» · {formatDuration(month.duration)}</small>
                </article>
                <article>
                  <span>За всё время в текущих карточках</span>
                  <strong>{totalReviews.toLocaleString('ru-RU')} повторений</strong>
                  <small>{totalLapses.toLocaleString('ru-RU')} срывов / возвратов в переучивание</small>
                </article>
              </div>

              <div className="anki-table-head">
                <div><strong>Каждая карточка</strong><span>«Повторений» — сколько раз Anki показывал карточку за всё время.</span></div>
                <label><Search size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setShowCount(20) }} placeholder="Найти слово…" /></label>
              </div>

              <div className="anki-card-table">
                <div className="anki-row anki-row-header"><span>Карточка</span><span>Повторений</span><span>Срывов</span><span>«Снова» 30д</span><span>Последний раз</span></div>
                {filteredCards.map(({ card, again }) => (
                  <div className="anki-row" key={card.anki_card_id}>
                    <span className="anki-card-name"><strong>{card.question_text || `#${card.anki_card_id}`}</strong>{card.answer_text && <small>{card.answer_text}</small>}</span>
                    <span>{card.reps}</span>
                    <span>{card.lapses}</span>
                    <span>{again}</span>
                    <span>{card.last_reviewed_at ? formatDateTime(card.last_reviewed_at) : 'не учил'}</span>
                  </div>
                ))}
              </div>
              {difficulty.length > filteredCards.length && (
                <button type="button" className="ghost-button" onClick={() => setShowCount((value) => value + 30)}>Показать ещё</button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )

  return createPortal(content, target)
}
