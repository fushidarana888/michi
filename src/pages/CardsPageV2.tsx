import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Brain,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Layers3,
  RefreshCw,
  Search,
  Sprout,
  TrendingUp,
} from 'lucide-react'
import {
  loadAnkiDashboardData,
  syncAnkiToMichi,
  type AnkiCardRow,
  type AnkiConnectionRow,
  type AnkiReviewRow,
} from '../lib/anki'
import {
  buildCardDifficulty,
  dailySeries,
  difficultySeverity,
  periodSummary,
  pickDifficultCards,
  pickStrongCards,
  pickUnsettledCards,
  type CardDifficultyRow,
} from '../lib/ankiAnalytics'
import './CardsPageV2.css'

type Dashboard = {
  connection: AnkiConnectionRow | null
  cards: AnkiCardRow[]
  reviews: AnkiReviewRow[]
}

function formatDuration(ms: number) {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes} мин`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`
}

function formatAnswerTime(ms: number) {
  if (!ms) return '—'
  if (ms < 1000) return `${Math.round(ms)} мс`
  return `${(ms / 1000).toFixed(1)} с`
}

function formatSync(value: string | null | undefined) {
  if (!value) return 'ещё не было'
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}

function formatInterval(days: number) {
  if (days <= 0) return 'обучение'
  if (days === 1) return '1 день'
  if (days < 30) return `${days} дн.`
  if (days < 365) return `${Math.round(days / 30)} мес.`
  return `${(days / 365).toFixed(1)} г.`
}

function pluralCards(value: number) {
  const n = Math.abs(value) % 100
  const n1 = n % 10
  if (n > 10 && n < 20) return 'карточек'
  if (n1 === 1) return 'карточка'
  if (n1 >= 2 && n1 <= 4) return 'карточки'
  return 'карточек'
}

function Metric({ value, label, detail }: { value: string; label: string; detail?: string }) {
  return <div className="cards-metric"><strong>{value}</strong><span>{label}</span>{detail && <small>{detail}</small>}</div>
}

function CardMiniList({ rows, kind }: { rows: CardDifficultyRow[]; kind: 'hard' | 'unsettled' | 'strong' }) {
  if (!rows.length) {
    return <div className="cards-empty">Пока ничего не выделяется.</div>
  }
  return (
    <div className="cards-mini-list">
      {rows.slice(0, 10).map((row) => (
        <article key={row.card.anki_card_id} className={`cards-mini-row ${kind}`}>
          <div>
            <strong>{row.card.question_text || `Карточка ${row.card.anki_card_id}`}</strong>
            {row.card.answer_text && <span>{row.card.answer_text}</span>}
          </div>
          <div className="cards-mini-signals">
            {kind === 'hard' && <b>{difficultySeverity(row)}</b>}
            {kind === 'unsettled' && <b>ещё не закрепилась</b>}
            {kind === 'strong' && <b>держится уверенно</b>}
            <span>Снова: {row.again}</span>
            <span>Трудно: {row.hard}</span>
            <span>показов: {row.card.reps}</span>
            <span>интервал: {formatInterval(row.card.interval_days)}</span>
          </div>
        </article>
      ))}
    </div>
  )
}

export function CardsPageV2({ userId }: { userId: string }) {
  const [data, setData] = useState<Dashboard>({ connection: null, cards: [], reviews: [] })
  const [busy, setBusy] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')

  async function load() {
    setBusy(true)
    try {
      setData(await loadAnkiDashboardData(userId))
      setMessage('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось загрузить карточки')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { void load() }, [userId])

  async function syncNow() {
    const deck = data.connection?.deck_name
    if (!deck || syncing) return
    setSyncing(true)
    setMessage('')
    try {
      const result = await syncAnkiToMichi(userId, deck)
      setMessage(`Синхронизировано: ${result.cardCount} карточек, новых записей повторения — ${result.newReviewCount}.`)
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось синхронизировать Anki')
    } finally {
      setSyncing(false)
    }
  }

  const today = useMemo(() => periodSummary(data.reviews, data.cards, 1), [data])
  const week = useMemo(() => periodSummary(data.reviews, data.cards, 7), [data])
  const prevWeek = useMemo(() => periodSummary(data.reviews, data.cards, 7, 7), [data])
  const month = useMemo(() => periodSummary(data.reviews, data.cards, 30), [data])
  const daily = useMemo(() => dailySeries(data.reviews, data.cards, 30), [data])
  const rows = useMemo(() => buildCardDifficulty(data.cards, data.reviews), [data])
  const difficult = useMemo(() => pickDifficultCards(rows), [rows])
  const unsettled = useMemo(() => pickUnsettledCards(rows, difficult), [rows, difficult])
  const strong = useMemo(() => pickStrongCards(rows), [rows])

  const totalReviews = data.cards.reduce((sum, card) => sum + Number(card.reps || 0), 0)
  const totalLapses = data.cards.reduce((sum, card) => sum + Number(card.lapses || 0), 0)
  const unseen = data.cards.filter((card) => card.reps === 0).length
  const learning = data.cards.filter((card) => card.reps > 0 && card.interval_days < 7).length
  const growing = data.cards.filter((card) => card.interval_days >= 7 && card.interval_days < 21).length
  const mature = data.cards.filter((card) => card.interval_days >= 21).length
  const activeDays = daily.filter((day) => day.reviews > 0).length
  const maxDailyReviews = Math.max(1, ...daily.map((day) => day.reviews))
  const weekDelta = prevWeek.reviews ? Math.round((week.reviews - prevWeek.reviews) / prevWeek.reviews * 100) : null

  const insights = useMemo(() => {
    const items: { tone: 'good' | 'warn' | 'neutral'; title: string; text: string }[] = []

    if (week.newCards === 0 && week.reviews >= 10) {
      items.push({ tone: 'warn', title: 'Словарь поддерживается, но почти не растёт', text: 'За 7 дней есть повторения, но нет новых карточек. Повторы засчитываются как поддержание памяти и не заменяют изучение нового.' })
    } else if (week.newCards > 0) {
      items.push({ tone: 'good', title: `Новых за неделю: ${week.newCards}`, text: 'Есть реальное расширение словаря, а не только поддерживающие повторы.' })
    }

    if (difficult.length) {
      items.push({ tone: 'warn', title: `Устойчиво проблемных: ${difficult.length}`, text: 'Это уже не единичные ранние ошибки: проблемы повторяются на достаточном количестве показов. Их стоит разобрать отдельно.' })
    } else {
      items.push({ tone: 'good', title: 'Устойчиво тяжёлых карточек сейчас нет', text: 'Ранние ошибки не считаются проблемой сами по себе. Michi ждёт повторяющийся сигнал.' })
    }

    if (unsettled.length) {
      items.push({ tone: 'neutral', title: `Ещё не закрепились: ${unsettled.length}`, text: 'Эти карточки пока молодые. Ошибки есть, но истории недостаточно, чтобы называть их тяжёлыми.' })
    }

    if (month.againRate >= 0.22 && month.reviews >= 20) {
      items.push({ tone: 'warn', title: '«Снова» встречается часто', text: `${Math.round(month.againRate * 100)}% ответов за 30 дней — «Снова». Лучше не увеличивать поток новых слов слишком резко.` })
    } else if (month.reviews >= 20) {
      items.push({ tone: 'good', title: 'Ошибки не захватывают колоду', text: `За 30 дней «Снова» — ${Math.round(month.againRate * 100)}% ответов.` })
    }

    if (activeDays >= 12) {
      items.push({ tone: 'good', title: `Карточки были в ${activeDays} из последних 30 дней`, text: 'Для SRS регулярность важнее длинных редких марафонов.' })
    }

    return items
  }, [activeDays, difficult.length, month, unsettled.length, week])

  const difficultIds = useMemo(() => new Set(difficult.map((row) => row.card.anki_card_id)), [difficult])
  const unsettledIds = useMemo(() => new Set(unsettled.map((row) => row.card.anki_card_id)), [unsettled])
  const strongIds = useMemo(() => new Set(strong.map((row) => row.card.anki_card_id)), [strong])

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    const list = query
      ? rows.filter((row) => `${row.card.question_text || ''} ${row.card.answer_text || ''}`.toLowerCase().includes(query))
      : rows
    return list.slice(0, 120)
  }, [rows, search])

  if (busy) return <div className="page cards-page"><section className="panel cards-loading">Собираем картину по карточкам…</section></div>

  if (!data.connection?.last_sync_at) {
    return (
      <div className="page cards-page">
        <section className="page-heading compact-heading"><div><p className="eyebrow">ANKI</p><h1>Карточки</h1><p className="muted">Здесь будет отдельная подробная аналитика японской лексики.</p></div></section>
        <section className="panel cards-empty-state"><Layers3 size={34} /><h2>Сначала синхронизируй Anki</h2><p className="muted">Подключение делается на странице «Куда дальше» при выбранном японском. После первой синхронизации данные останутся доступны и без запущенного Anki.</p></section>
      </div>
    )
  }

  return (
    <div className="page cards-page">
      <section className="page-heading compact-heading cards-page-heading">
        <div>
          <p className="eyebrow">ANKI · ЯПОНСКИЙ</p>
          <h1>Карточки</h1>
          <p className="muted">Не просто счётчик повторений: что растёт, что забывается, что ещё рано оценивать и куда лучше направить внимание.</p>
        </div>
        <div className="cards-sync-box">
          <span>Колода: <b>{data.connection.deck_name}</b></span>
          <small>последняя синхронизация: {formatSync(data.connection.last_sync_at)}</small>
          <button className="primary-button" disabled={syncing} onClick={() => void syncNow()}><RefreshCw size={17} className={syncing ? 'cards-spin' : ''} /> {syncing ? 'Синхронизация…' : 'Синхронизировать'}</button>
        </div>
      </section>

      {message && <div className="panel cards-message"><CheckCircle2 size={17} /> {message}</div>}

      <section className="cards-metric-grid">
        <Metric value={String(today.reviews)} label="ответов сегодня" detail={`${today.unique} разных · ${today.newCards} новых`} />
        <Metric value={String(week.reviews)} label="ответов за 7 дней" detail={`${week.unique} разных · ${week.newCards} новых`} />
        <Metric value={String(month.reviews)} label="ответов за 30 дней" detail={`${month.unique} разных · ${month.newCards} новых`} />
        <Metric value={String(data.cards.length)} label="карточек в колоде" detail={`${totalReviews.toLocaleString('ru-RU')} показов всего`} />
        <Metric value={formatDuration(month.durationMs)} label="время ответов за 30 дней" detail={`средний ответ ${formatAnswerTime(month.avgAnswerMs)}`} />
        <Metric value={`${Math.round(month.againRate * 100)}%`} label="ответов «Снова» за 30 дней" detail={`${totalLapses} переучиваний за всё время`} />
      </section>

      <section className="panel cards-insights-panel">
        <div className="cards-section-title"><Brain size={20} /><div><p className="eyebrow">ВЫВОДЫ MICHI</p><h2>Что сейчас видно по твоим карточкам</h2></div></div>
        <div className="cards-insights-grid">
          {insights.map((insight) => <article className={`cards-insight ${insight.tone}`} key={insight.title}><strong>{insight.title}</strong><span>{insight.text}</span></article>)}
        </div>
      </section>

      <section className="cards-two-col">
        <div className="panel cards-stage-panel">
          <div className="cards-section-title"><Layers3 size={19} /><div><p className="eyebrow">СОСТОЯНИЕ КОЛОДЫ</p><h2>На какой стадии карточки</h2></div></div>
          <div className="cards-stage-grid">
            <div><strong>{unseen}</strong><span>ещё не показаны</span></div>
            <div><strong>{learning}</strong><span>интервал до 7 дней</span></div>
            <div><strong>{growing}</strong><span>интервал 7–20 дней</span></div>
            <div><strong>{mature}</strong><span>интервал 21+ дней</span></div>
          </div>
        </div>

        <div className="panel cards-stage-panel">
          <div className="cards-section-title"><TrendingUp size={19} /><div><p className="eyebrow">ТЕМП</p><h2>Последняя неделя</h2></div></div>
          <div className="cards-tempo-copy">
            <strong>{weekDelta == null ? `${week.reviews} ответов` : `${weekDelta >= 0 ? '+' : ''}${weekDelta}% к прошлой неделе`}</strong>
            <span>{week.reviews} ответов сейчас против {prevWeek.reviews} в предыдущие 7 дней.</span>
            <span>{week.newCards} новых карточек · {formatDuration(week.durationMs)} чистого времени ответов.</span>
          </div>
        </div>
      </section>

      <section className="panel cards-calendar-panel">
        <div className="cards-section-title"><CalendarDays size={19} /><div><p className="eyebrow">30 ДНЕЙ</p><h2>Ритм повторений</h2></div></div>
        <div className="cards-bars" aria-label="Повторения за последние 30 дней">
          {daily.map((day) => (
            <div className="cards-bar-column" key={day.key} title={`${day.label}: ${day.reviews} ответов, ${day.newCards} новых`}>
              <div className="cards-bar-track"><span style={{ height: `${Math.max(day.reviews ? 8 : 0, day.reviews / maxDailyReviews * 100)}%` }} /></div>
              <small>{day.label.slice(0, 2)}</small>
            </div>
          ))}
        </div>
        <div className="cards-calendar-summary"><span><Activity size={15} /> активных дней: <b>{activeDays}/30</b></span><span><Clock3 size={15} /> всего: <b>{formatDuration(month.durationMs)}</b></span><span><Sprout size={15} /> новых: <b>{month.newCards}</b></span></div>
      </section>

      <section className="cards-two-col cards-focus-grid">
        <div className="panel cards-list-panel danger">
          <div className="cards-section-title"><AlertTriangle size={19} /><div><p className="eyebrow">НУЖНО ВНИМАНИЕ</p><h2>Устойчиво тяжёлые · {difficult.length}</h2><p>Только карточки с повторяющейся проблемой. Один «Снова» из двух показов сюда не попадает.</p></div></div>
          <CardMiniList rows={difficult} kind="hard" />
        </div>
        <div className="panel cards-list-panel young">
          <div className="cards-section-title"><Sprout size={19} /><div><p className="eyebrow">ЕЩЁ РАНО СУДИТЬ</p><h2>Не закрепились · {unsettled.length}</h2><p>Ошибки уже были, но карточки ещё молодые и им нужно несколько нормальных повторений.</p></div></div>
          <CardMiniList rows={unsettled} kind="unsettled" />
        </div>
      </section>

      <section className="panel cards-list-panel strong">
        <div className="cards-section-title"><CheckCircle2 size={19} /><div><p className="eyebrow">ПОЛУЧАЕТСЯ</p><h2>Карточки, которые уже держатся уверенно</h2><p>Длинный интервал, достаточно показов и нет свежих «Снова».</p></div></div>
        <CardMiniList rows={strong} kind="strong" />
      </section>

      <section className="panel cards-answer-panel">
        <div className="cards-section-title"><Activity size={19} /><div><p className="eyebrow">ОТВЕТЫ ЗА 30 ДНЕЙ</p><h2>Какие кнопки ты нажимаешь</h2></div></div>
        <div className="cards-answer-grid">
          {[
            ['Снова', month.again, 'again'],
            ['Трудно', month.hard, 'hard'],
            ['Хорошо', month.good, 'good'],
            ['Легко', month.easy, 'easy'],
          ].map(([label, value, kind]) => {
            const count = Number(value)
            const percent = month.reviews ? Math.round(count / month.reviews * 100) : 0
            return <div className={`cards-answer ${kind}`} key={String(label)}><strong>{count}</strong><span>{label}</span><small>{percent}% всех ответов</small><div><i style={{ width: `${percent}%` }} /></div></div>
          })}
        </div>
      </section>

      <section className="panel cards-table-panel">
        <div className="cards-table-head">
          <div><p className="eyebrow">ВСЯ КОЛОДА</p><h2>Разобрать по карточкам</h2><p className="muted">Поиск, статус, число показов, свежие ошибки, переучивания и текущий интервал.</p></div>
          <label className="cards-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти слово…" /></label>
        </div>
        <div className="cards-table-wrap">
          <table className="cards-table">
            <thead><tr><th>Карточка</th><th>Статус</th><th>Показов</th><th>Снова 30д</th><th>Трудно 30д</th><th>Переуч.</th><th>Интервал</th></tr></thead>
            <tbody>
              {filteredRows.map((row) => {
                let state = 'обычная'
                if (difficultIds.has(row.card.anki_card_id)) state = 'тяжёлая'
                else if (unsettledIds.has(row.card.anki_card_id)) state = 'не закрепилась'
                else if (strongIds.has(row.card.anki_card_id)) state = 'уверенно'
                return <tr key={row.card.anki_card_id}>
                  <td><strong>{row.card.question_text || `Карточка ${row.card.anki_card_id}`}</strong>{row.card.answer_text && <small>{row.card.answer_text}</small>}</td>
                  <td><span className={`cards-state state-${state.replaceAll(' ', '-')}`}>{state}</span></td>
                  <td>{row.card.reps}</td><td>{row.again}</td><td>{row.hard}</td><td>{row.card.lapses}</td><td>{formatInterval(row.card.interval_days)}</td>
                </tr>
              })}
            </tbody>
          </table>
        </div>
        <p className="muted tiny">Показано {filteredRows.length} из {rows.length} изучавшихся карточек. «Тяжёлая» требует устойчивого сигнала; ранняя единичная ошибка остаётся в «не закрепилась».</p>
      </section>
    </div>
  )
}
