import { Component, useEffect, useMemo, useState, type ErrorInfo, type FormEvent, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  AlertCircle,
  BarChart3,
  BookOpen,
  Brain,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Compass,
  LogOut,
  Map,
  PiggyBank,
  Play,
  Plus,
  RotateCcw,
  Settings,
  Smile,
  Sparkles,
  Square,
} from 'lucide-react'
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { LEARNING_STATUS_OPTIONS, MOODS, reasonsForMood } from './data/presets'
import { formatDateRu, localDateKey } from './lib/date'
import { buildAttentionCards, ensureWorkspace, loadNavigationData, type AttentionCard } from './lib/navigation'
import { SavingsPageV2 } from './pages/SavingsPageV2'
import { supabase } from './lib/supabase'
import type { LearningNode, LearningStatus, MoodEntry, Profile, StudyLog, Subject } from './types'
import './AppV2.css'

const statusLabels = Object.fromEntries(LEARNING_STATUS_OPTIONS) as Record<LearningStatus, string>
const durationOptions = [10, 15, 20, 30, 45, 60, 90]
const activityLabels = {
  theory: 'Теория',
  practice: 'Практика',
  review: 'Повторение',
  test: 'Тест / вариант',
  lesson: 'Урок',
  other: 'Другое',
} as const

type ActivityKind = keyof typeof activityLabels

type ActiveStudy = {
  userId: string
  subjectId: string
  subjectName: string
  nodeId: string | null
  nodeStatus: LearningStatus | null
  nodeTitle: string | null
  plannedMinutes: number
  startedAt: number
}

type StudyReview = Omit<ActiveStudy, 'startedAt'> & {
  minutes: number
  difficulty: number | null
  note: string
}

const ACTIVE_STUDY_KEY = 'michi-active-study-v2'

function readActiveStudy(userId: string): ActiveStudy | null {
  try {
    const raw = localStorage.getItem(ACTIVE_STUDY_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ActiveStudy
    return parsed.userId === userId ? parsed : null
  } catch {
    return null
  }
}

function formatClock(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = String(seconds % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

function clampMinutes(value: number) {
  return Math.max(1, Math.min(600, Math.round(value || 1)))
}

function studyKind(status: LearningStatus | null): ActivityKind {
  return status === 'not_started' || status === 'learning' ? 'theory' : 'practice'
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Michi UI error', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="crash-screen">
        <div className="brand-mark large">M</div>
        <h1>Michi споткнулся, но данные не потеряны</h1>
        <p>Интерфейс поймал ошибку вместо белой страницы. Можно перезагрузить приложение или сбросить только локальный таймер.</p>
        <div className="action-row">
          <button className="primary-button" onClick={() => window.location.reload()}><RotateCcw size={17} /> Перезагрузить</button>
          <button className="secondary-button" onClick={() => { localStorage.removeItem(ACTIVE_STUDY_KEY); window.location.reload() }}>Сбросить таймер</button>
        </div>
        <details><summary>Техническая информация</summary><pre>{this.state.error.message}</pre></details>
      </main>
    )
  }
}

function LoadingScreen({ text = 'Загружаем Michi…' }: { text?: string }) {
  return <div className="center-screen"><div className="brand-mark">M</div><div className="loader-dot" /><p className="muted">{text}</p></div>
}

function AuthPage() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { display_name: name || 'Ученик' } } })
        if (error) throw error
        if (!data.session) setMessage('Аккаунт создан. Если в проекте включено подтверждение почты, Supabase попросит открыть письмо.')
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось войти')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-copy">
        <div className="brand-mark large">M</div>
        <p className="eyebrow">MICHI</p>
        <h1>Большая цель.<br />Следующий шаг.</h1>
        <p className="muted lead">Не трекер серии дней. Michi нужен, чтобы вовремя замечать перекосы между учёбой, языком и долгими целями.</p>
      </section>
      <section className="panel auth-card">
        <div className="segmented">
          <button type="button" className={mode === 'signin' ? 'active' : ''} onClick={() => setMode('signin')}>Войти</button>
          <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Создать аккаунт</button>
        </div>
        <form className="form-stack" onSubmit={submit}>
          {mode === 'signup' && <label><span>Имя или ник</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Как тебя называть" /></label>}
          <label><span>Email</span><input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label><span>Пароль</span><input required minLength={6} type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <button className="primary-button wide" disabled={busy}>{busy ? 'Подождите…' : mode === 'signin' ? 'Войти' : 'Начать'}</button>
        </form>
        {message && <p className="form-message">{message}</p>}
      </section>
    </main>
  )
}

function OnboardingPage({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const [name, setName] = useState(profile.display_name || '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function finish() {
    setBusy(true)
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    const { error } = await supabase.from('profiles').update({ display_name: name || 'Ученик', timezone, onboarding_completed: true }).eq('id', profile.id)
    setBusy(false)
    if (error) return setMessage(error.message)
    onDone()
  }

  return (
    <main className="onboarding-page">
      <section className="panel onboarding-card">
        <p className="eyebrow">ПЕРЕД СТАРТОМ</p>
        <h1>Здесь нет долга перед приложением</h1>
        <p className="muted lead">Michi показывает, что разумнее делать дальше. Ты всегда можешь выбрать другой предмет или вообще не заниматься сегодня.</p>
        <div className="principle-grid">
          <div><Compass size={22} /><strong>Карта внимания</strong><span>Показывает перекос за недели, а не судит один день.</span></div>
          <div><Map size={22} /><strong>Карта знаний</strong><span>Понимает, где ты ещё учишь инструмент, а где уже нужна практика.</span></div>
          <div><PiggyBank size={22} /><strong>Сбережения</strong><span>Помогает не слить одним днём то, что копил месяцами.</span></div>
        </div>
        <label className="onboarding-name"><span>Имя или ник</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <button className="primary-button wide" onClick={() => void finish()} disabled={busy}>{busy ? 'Настраиваем…' : 'Открыть Michi'}</button>
        {message && <p className="form-message error">{message}</p>}
      </section>
    </main>
  )
}

function BottomLink({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return <NavLink to={to} className={({ isActive }) => `bottom-link${isActive ? ' active' : ''}`}>{icon}<span>{label}</span></NavLink>
}

function AppShell({ userId, profile, reloadProfile }: { userId: string; profile: Profile; reloadProfile: () => Promise<void> }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink className="brand-inline" to="/navigate"><div className="brand-mark small">M</div><div><strong>Michi</strong><span>{profile.display_name || 'Большая цель. Следующий шаг.'}</span></div></NavLink>
        <NavLink to="/settings" className="icon-button" aria-label="Настройки"><Settings size={19} /></NavLink>
      </header>
      <main className="app-content">
        <Routes>
          <Route path="/navigate" element={<NavigatorPage userId={userId} />} />
          <Route path="/route" element={<RouteMapPage userId={userId} />} />
          <Route path="/savings" element={<SavingsPageV2 userId={userId} />} />
          <Route path="/progress" element={<ProgressPage userId={userId} />} />
          <Route path="/mood" element={<MoodPage userId={userId} />} />
          <Route path="/tutor" element={<TutorPage profile={profile} />} />
          <Route path="/settings" element={<SettingsPage userId={userId} profile={profile} reloadProfile={reloadProfile} />} />
          <Route path="*" element={<Navigate to="/navigate" replace />} />
        </Routes>
      </main>
      <nav className="bottom-nav">
        <BottomLink to="/navigate" icon={<Compass size={20} />} label="Куда дальше" />
        <BottomLink to="/route" icon={<Map size={20} />} label="Маршрут" />
        <BottomLink to="/savings" icon={<PiggyBank size={20} />} label="Деньги" />
        <BottomLink to="/progress" icon={<BarChart3 size={20} />} label="Картина" />
        <BottomLink to="/mood" icon={<Smile size={20} />} label="Настроение" />
      </nav>
    </div>
  )
}

function durationHint(minutes: number) {
  if (minutes <= 10) return 'Возьми совсем маленький кусок: одно правило, пару слов или одну короткую задачу.'
  if (minutes <= 25) return 'Хватит на один понятный кусок без попытки закрыть весь предмет.'
  if (minutes <= 45) return 'Можно разобрать один инструмент и немного закрепить его.'
  if (minutes <= 70) return 'Получится полноценный блок: разобраться и порешать.'
  return 'Это длинный блок. Лучше сделать короткий перерыв внутри.'
}

function NavigatorPage({ userId }: { userId: string }) {
  const navigate = useNavigate()
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [nodes, setNodes] = useState<LearningNode[]>([])
  const [logs, setLogs] = useState<StudyLog[]>([])
  const [duration, setDuration] = useState(30)
  const [customDuration, setCustomDuration] = useState('')
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null)
  const [restToday, setRestToday] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [activeStudy, setActiveStudy] = useState<ActiveStudy | null>(() => readActiveStudy(userId))
  const [review, setReview] = useState<StudyReview | null>(null)
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState('')

  async function load() {
    setBusy(true)
    try {
      const data = await loadNavigationData(userId)
      setSubjects(data.subjects)
      setNodes(data.nodes)
      setLogs(data.logs)
      setMessage('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось загрузить карту')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { void load() }, [userId])
  useEffect(() => {
    if (!activeStudy) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [activeStudy])

  const cards = useMemo(() => buildAttentionCards(subjects, nodes, logs), [subjects, nodes, logs])
  const suggested = cards[0]
  const current = selectedSubjectId ? cards.find((card) => card.subject.id === selectedSubjectId) || suggested : suggested
  const elapsedSeconds = activeStudy ? Math.max(0, Math.floor((now - activeStudy.startedAt) / 1000)) : 0

  function chooseDuration(value: number) {
    setDuration(value)
    setCustomDuration('')
  }

  function chooseCustom(value: string) {
    setCustomDuration(value)
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) setDuration(Math.max(1, Math.min(240, Math.round(parsed))))
  }

  function selectCard(card: AttentionCard) {
    setSelectedSubjectId(card.subject.id)
    setRestToday(false)
  }

  function startStudy() {
    if (!current) return
    const session: ActiveStudy = {
      userId,
      subjectId: current.subject.id,
      subjectName: current.subject.name,
      nodeId: current.currentNode?.id || null,
      nodeStatus: current.currentNode?.status || null,
      nodeTitle: current.currentNode?.title || null,
      plannedMinutes: duration,
      startedAt: Date.now(),
    }
    localStorage.setItem(ACTIVE_STUDY_KEY, JSON.stringify(session))
    setActiveStudy(session)
    setReview(null)
    setNow(Date.now())
  }

  function finishStudy() {
    if (!activeStudy) return
    setReview({ ...activeStudy, minutes: clampMinutes(Math.ceil((Date.now() - activeStudy.startedAt) / 60_000)), difficulty: null, note: '' })
    setActiveStudy(null)
    localStorage.removeItem(ACTIVE_STUDY_KEY)
  }

  function alreadyDone() {
    if (!current) return
    setReview({
      userId,
      subjectId: current.subject.id,
      subjectName: current.subject.name,
      nodeId: current.currentNode?.id || null,
      nodeStatus: current.currentNode?.status || null,
      nodeTitle: current.currentNode?.title || null,
      plannedMinutes: duration,
      minutes: duration,
      difficulty: null,
      note: '',
    })
  }

  function cancelStudy() {
    setActiveStudy(null)
    setReview(null)
    localStorage.removeItem(ACTIVE_STUDY_KEY)
    setMessage('Таймер отменён. В статистику ничего не записано.')
  }

  async function saveReview() {
    if (!review) return
    const minutes = clampMinutes(review.minutes)
    const { error } = await supabase.from('study_logs').insert({
      user_id: userId,
      subject_id: review.subjectId,
      learning_node_id: review.nodeId,
      minutes,
      activity_kind: studyKind(review.nodeStatus),
      perceived_difficulty: review.difficulty,
      note: review.note || null,
      source: 'manual',
    })
    if (error) return setMessage(error.message)

    if (review.nodeId && review.nodeStatus === 'not_started') {
      await supabase.from('learning_nodes').update({ status: 'learning' }).eq('id', review.nodeId).eq('user_id', userId)
    }

    setReview(null)
    setMessage(`Записано: ${review.subjectName}, ${minutes} мин.`)
    await load()
  }

  if (busy) return <LoadingScreen text="Собираем карту внимания…" />

  return (
    <div className="page">
      <section className="page-heading compact-heading">
        <div><p className="eyebrow">НАВИГАТОР</p><h1>Куда двигаться дальше</h1><p className="muted">Рекомендация — это подсказка. Другой предмет или день без учёбы тоже допустимы.</p></div>
        <button className="secondary-button" onClick={() => setManualOpen((v) => !v)}><Plus size={17} /> Записать вручную</button>
      </section>

      {manualOpen && <ManualLogForm userId={userId} subjects={subjects} nodes={nodes} onSaved={() => { setManualOpen(false); void load() }} />}

      <section className="panel recommendation-card recommendation-v2">
        {restToday ? (
          <div className="rest-state">
            <p className="eyebrow">СЕГОДНЯ БЕЗ УЧЁБЫ</p>
            <h2>Окей. Ничего догонять завтра не нужно.</h2>
            <p className="muted">Пропущенного задания не появляется, серия не сгорает и долг не копится. Следующий раз Michi просто пересчитает картину.</p>
            <button className="secondary-button" onClick={() => setRestToday(false)}>Если передумаю — показать варианты</button>
          </div>
        ) : (
          <>
            <div className="recommendation-top polished-top">
              <div><p className="eyebrow">{selectedSubjectId ? 'ТЫ ВЫБРАЛ' : 'СЕЙЧАС РАЗУМНЕЕ'}</p><h2>{current ? `${current.subject.icon || '•'} ${current.subject.name}` : 'Собираем историю'}</h2></div>
              <div className="duration-picker polished-duration">
                {durationOptions.map((value) => <button type="button" key={value} className={!customDuration && duration === value ? 'active' : ''} onClick={() => chooseDuration(value)}>{value} мин</button>)}
                <input aria-label="Своё время" type="number" min="1" max="240" inputMode="numeric" value={customDuration} onChange={(e) => chooseCustom(e.target.value)} placeholder="своё" />
              </div>
            </div>

            {current && (
              <>
                <div className="recommendation-body-v2">
                  <div>
                    <p className="recommendation-action">{current.action}</p>
                    {current.currentNode?.description && <p className="node-description"><BookOpen size={17} /> {current.currentNode.description}</p>}
                    <p className="muted">{current.reason} {durationHint(duration)}</p>
                  </div>
                  <div className="recommendation-meta">
                    <span><Clock3 size={15} /> {current.minutes} мин за 28 дней</span>
                    <span><BookOpen size={15} /> {current.currentNode ? statusLabels[current.currentNode.status] : 'маршрут закрыт'}</span>
                    <span><Clock3 size={15} /> сейчас: {duration} мин</span>
                  </div>
                </div>

                {activeStudy ? (
                  <div className="study-live-box">
                    <div><p className="eyebrow">ЗАНЯТИЕ ИДЁТ</p><strong>{activeStudy.subjectName}</strong>{activeStudy.nodeTitle && <span>{activeStudy.nodeTitle}</span>}</div>
                    <div className="study-clock">{formatClock(elapsedSeconds)}</div>
                    <div className="action-row"><button className="primary-button" onClick={finishStudy}><Square size={17} /> Готово</button><button className="secondary-button" onClick={cancelStudy}>Отменить</button></div>
                  </div>
                ) : review ? (
                  <div className="study-review-box">
                    <div><p className="eyebrow">ЗАПИСАТЬ ВЫПОЛНЕННОЕ</p><h3>{review.subjectName}{review.nodeTitle ? ` · ${review.nodeTitle}` : ''}</h3></div>
                    <div className="review-grid">
                      <label><span>Минуты</span><input type="number" min="1" max="600" value={review.minutes} onChange={(e) => setReview({ ...review, minutes: Number(e.target.value) })} /></label>
                      <label><span>Заметка — необязательно</span><input value={review.note} onChange={(e) => setReview({ ...review, note: e.target.value })} placeholder="Что сделал / где застрял" /></label>
                    </div>
                    <div className="difficulty-row"><span className="muted tiny">Как шло?</span>{[[1, 'Легко'], [2, 'Нормально'], [3, 'Тяжело'], [4, 'Не понял']].map(([value, label]) => <button key={value} type="button" className={`chip${review.difficulty === value ? ' selected' : ''}`} onClick={() => setReview({ ...review, difficulty: review.difficulty === value ? null : Number(value) })}>{label}</button>)}</div>
                    <div className="action-row"><button className="primary-button" onClick={() => void saveReview()}><CheckCircle2 size={17} /> Сохранить как выполненное</button><button className="secondary-button" onClick={() => setReview(null)}>Не сохранять</button></div>
                  </div>
                ) : (
                  <div className="study-action-zone">
                    <button className="primary-button start-button" onClick={startStudy}><Play size={18} /> Начать занятие</button>
                    <button className="secondary-button" onClick={alreadyDone}><CheckCircle2 size={17} /> Уже сделал</button>
                    <button className="secondary-button" onClick={() => navigate('/route')}>Открыть маршрут</button>
                  </div>
                )}
              </>
            )}

            <div className="choice-zone">
              <div className="action-row"><button className="secondary-button" onClick={() => { if (!cards.length) return; const index = Math.max(0, cards.findIndex((c) => c.subject.id === current?.subject.id)); selectCard(cards[(index + 1) % cards.length]) }}>Другой предмет</button><button className="secondary-button" onClick={() => setRestToday(true)}>Сегодня вообще не занимаюсь</button>{selectedSubjectId && <button className="ghost-button" onClick={() => setSelectedSubjectId(null)}>Вернуть рекомендацию Michi</button>}</div>
              {cards.length > 1 && <div className="subject-quick-picks"><span className="muted tiny">Или выбери сам:</span>{cards.map((card) => <button type="button" key={card.subject.id} className={current?.subject.id === card.subject.id ? 'selected' : ''} onClick={() => selectCard(card)}>{card.subject.icon || '•'} {card.subject.name}</button>)}</div>}
            </div>
          </>
        )}
      </section>

      {message && <div className="toast-inline"><CheckCircle2 size={17} /><span>{message}</span></div>}

      <section>
        <div className="section-heading"><div><p className="eyebrow">ПОСЛЕДНИЕ 28 ДНЕЙ</p><h2>Карта внимания</h2></div><span className="muted tiny">ориентир, не квота</span></div>
        <div className="attention-grid">
          {cards.map((card) => <article className={`panel attention-card state-${card.state}`} key={card.subject.id} onClick={() => selectCard(card)} role="button" tabIndex={0}>
            <div className="attention-title"><span className="subject-icon">{card.subject.icon || '•'}</span><div><strong>{card.subject.name}</strong><small>{card.reason}</small></div></div>
            <div className="share-row"><strong>{Math.round(card.share * 100)}%</strong><span>{card.minutes} мин</span></div>
            <div className="bar-track"><span style={{ width: `${Math.min(100, card.share * 100)}%` }} /></div>
            <div className="reference-mark">ориентир ≈ {Math.round(card.targetShare * 100)}%</div>
            <div className="next-node"><span>Следующий узел</span><strong>{card.currentNode?.title || 'Смешанная практика'}</strong></div>
          </article>)}
        </div>
      </section>

      <section className="panel anti-pressure-card"><CheckCircle2 size={22} /><div><strong>Не открыл Michi — ничего не потерял.</strong><p>Мы считаем фактическую подготовку, а не серию входов в приложение.</p></div></section>
    </div>
  )
}

function ManualLogForm({ userId, subjects, nodes, onSaved }: { userId: string; subjects: Subject[]; nodes: LearningNode[]; onSaved: () => void }) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.id || '')
  const [nodeId, setNodeId] = useState('')
  const [minutes, setMinutes] = useState('30')
  const [kind, setKind] = useState<ActivityKind>('practice')
  const [difficulty, setDifficulty] = useState('')
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')
  const subjectNodes = nodes.filter((node) => node.subject_id === subjectId)

  async function save(event: FormEvent) {
    event.preventDefault()
    const parsedMinutes = Number(minutes)
    if (!subjectId || !Number.isFinite(parsedMinutes) || parsedMinutes <= 0) return setMessage('Выбери предмет и нормальное время.')
    const { error } = await supabase.from('study_logs').insert({ user_id: userId, subject_id: subjectId, learning_node_id: nodeId || null, minutes: clampMinutes(parsedMinutes), activity_kind: kind, perceived_difficulty: difficulty ? Number(difficulty) : null, note: note || null, source: 'manual' })
    if (error) return setMessage(error.message)
    onSaved()
  }

  return <form className="panel log-composer polished-form" onSubmit={save}><div className="section-heading"><div><p className="eyebrow">ФАКТ, НЕ ПЛАН</p><h2>Записать занятие</h2></div></div><div className="form-grid four"><label><span>Направление</span><select value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setNodeId('') }}>{subjects.map((s) => <option value={s.id} key={s.id}>{s.icon} {s.name}</option>)}</select></label><label><span>Что именно</span><select value={nodeId} onChange={(e) => setNodeId(e.target.value)}><option value="">Без конкретного узла</option>{subjectNodes.map((n) => <option value={n.id} key={n.id}>{n.title}</option>)}</select></label><label><span>Минуты</span><input inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></label><label><span>Тип</span><select value={kind} onChange={(e) => setKind(e.target.value as ActivityKind)}>{Object.entries(activityLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label></div><div className="form-grid two"><label><span>Как шло</span><select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}><option value="">Не отмечать</option><option value="1">Легко</option><option value="2">Нормально</option><option value="3">Тяжело</option><option value="4">Не понял</option></select></label><label><span>Заметка</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Например: разобрал №21" /></label></div><button className="primary-button">Записать</button>{message && <p className="form-message error">{message}</p>}</form>
}

function RouteMapPage({ userId }: { userId: string }) {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [nodes, setNodes] = useState<LearningNode[]>([])
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState('')

  async function load() {
    setBusy(true)
    try {
      const data = await loadNavigationData(userId)
      setSubjects(data.subjects)
      setNodes(data.nodes)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Ошибка загрузки') }
    finally { setBusy(false) }
  }
  useEffect(() => { void load() }, [userId])

  async function changeStatus(node: LearningNode, status: LearningStatus) {
    setNodes((current) => current.map((item) => item.id === node.id ? { ...item, status } : item))
    const { error } = await supabase.from('learning_nodes').update({ status }).eq('id', node.id).eq('user_id', userId)
    if (error) { setMessage(error.message); void load() }
  }

  if (busy) return <LoadingScreen text="Открываем карту знаний…" />
  return <div className="page"><section className="page-heading compact-heading"><div><p className="eyebrow">КАРТА ЗНАНИЙ</p><h1>Что ты уже умеешь</h1><p className="muted">Статусы можно менять руками. Это навигация, а не оценка.</p></div></section><div className="route-stack">{subjects.map((subject) => { const subjectNodes = nodes.filter((n) => n.subject_id === subject.id); const current = subjectNodes.find((n) => n.status !== 'solid'); return <section className="panel route-card" key={subject.id}><div className="route-header"><div className="attention-title"><span className="subject-icon big">{subject.icon || '•'}</span><div><h2>{subject.name}</h2><span className="muted tiny">{subjectNodes.filter((n) => n.status === 'solid').length} из {subjectNodes.length} закреплено</span></div></div>{current && <span className="phase-badge">Сейчас: {current.title}</span>}</div><div className="node-list">{subjectNodes.map((node, index) => <div className={`learning-node status-${node.status}${node.id === current?.id ? ' current-node' : ''}`} key={node.id}><span className="node-number">{index + 1}</span><div className="node-copy"><strong>{node.title}</strong><span>{node.description}</span></div><select value={node.status} onChange={(e) => void changeStatus(node, e.target.value as LearningStatus)}>{LEARNING_STATUS_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>)}</div></section>})}</div>{message && <p className="form-message error">{message}</p>}</div>
}

function ProgressPage({ userId }: { userId: string }) {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [nodes, setNodes] = useState<LearningNode[]>([])
  const [logs, setLogs] = useState<StudyLog[]>([])
  const [savings, setSavings] = useState(0)
  const [busy, setBusy] = useState(true)

  useEffect(() => { void (async () => { const data = await loadNavigationData(userId); const tx = await supabase.from('savings_transactions').select('saved_amount_rub').eq('user_id', userId); setSubjects(data.subjects); setNodes(data.nodes); setLogs(data.logs); setSavings((tx.data || []).reduce((sum, row) => sum + Number(row.saved_amount_rub || 0), 0)); setBusy(false) })() }, [userId])
  if (busy) return <LoadingScreen text="Собираем общую картину…" />

  const cards = buildAttentionCards(subjects, nodes, logs)
  const totalMinutes = logs.reduce((sum, log) => sum + Number(log.minutes), 0)
  const studyDays = new Set(logs.map((log) => localDateKey(new Date(log.occurred_at)))).size
  const touched = cards.filter((card) => card.minutes > 0).length
  const recent = logs.slice(0, 8)
  const subjectById = Object.fromEntries(subjects.map((subject) => [subject.id, subject]))

  return <div className="page"><section className="page-heading compact-heading"><div><p className="eyebrow">ПОСЛЕДНИЕ 28 ДНЕЙ</p><h1>Общая картина</h1><p className="muted">Не серия. Просто факты, чтобы заметить перекос раньше, чем пройдёт месяц.</p></div></section><div className="stats-grid"><Stat value={`${Math.round(totalMinutes / 6) / 10} ч`} label="учёбы" /><Stat value={String(studyDays)} label="дней с занятиями" /><Stat value={`${touched}/${subjects.length}`} label="направлений трогал" /><Stat value={`${Math.round(savings).toLocaleString('ru-RU')} ₽`} label="в сбережениях" /></div><section className="panel distribution-card"><div className="section-heading"><div><p className="eyebrow">РАСПРЕДЕЛЕНИЕ</p><h2>Куда ушло время</h2></div></div><div className="distribution-list">{[...cards].sort((a, b) => b.minutes - a.minutes).map((card) => <div className="distribution-row" key={card.subject.id}><div><strong>{card.subject.icon} {card.subject.name}</strong><span>{card.minutes} мин · {Math.round(card.share * 100)}%</span></div><div className="bar-track"><span style={{ width: `${Math.min(100, card.share * 100)}%` }} /></div></div>)}</div></section><section><div className="section-heading"><div><p className="eyebrow">ПОСЛЕДНИЕ ЗАНЯТИЯ</p><h2>Что реально делал</h2></div></div><div className="recent-log-list">{recent.length ? recent.map((log) => <article className="panel recent-log" key={log.id}><div><strong>{subjectById[log.subject_id]?.icon} {subjectById[log.subject_id]?.name || 'Предмет'}</strong><span>{formatDateRu(localDateKey(new Date(log.occurred_at)))} · {log.minutes} мин · {activityLabels[log.activity_kind]}</span>{log.note && <small>{log.note}</small>}</div>{log.perceived_difficulty && <span className="status-badge">{['', 'Легко', 'Нормально', 'Тяжело', 'Не понял'][log.perceived_difficulty]}</span>}</article>) : <div className="panel empty-state">Пока занятий нет. Можно начать с главного экрана.</div>}</div></section></div>
}

function Stat({ value, label }: { value: string; label: string }) { return <article className="panel stat-card"><strong>{value}</strong><span>{label}</span></article> }

function MoodPage({ userId }: { userId: string }) {
  const [cursor, setCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [entries, setEntries] = useState<Record<string, MoodEntry>>({})
  const [reasonsMap, setReasonsMap] = useState<Record<string, string[]>>({})
  const [selectedDate, setSelectedDate] = useState(localDateKey())
  const [mood, setMood] = useState<number | null>(null)
  const [reasons, setReasons] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
  const firstKey = localDateKey(first)
  const nextKey = localDateKey(next)

  async function loadMonth() {
    const result = await supabase.from('mood_entries').select('*').eq('user_id', userId).gte('entry_date', firstKey).lt('entry_date', nextKey)
    const rows = (result.data || []) as MoodEntry[]
    setEntries(Object.fromEntries(rows.map((entry) => [entry.entry_date, entry])))
    if (!rows.length) return setReasonsMap({})
    const ids = rows.map((row) => row.id)
    const reasonResult = await supabase.from('mood_entry_reasons').select('mood_entry_id,reason_key').eq('user_id', userId).in('mood_entry_id', ids)
    const nextReasons: Record<string, string[]> = {}
    for (const row of reasonResult.data || []) nextReasons[row.mood_entry_id] = [...(nextReasons[row.mood_entry_id] || []), row.reason_key]
    setReasonsMap(nextReasons)
  }

  useEffect(() => { void loadMonth() }, [userId, firstKey])
  useEffect(() => { const entry = entries[selectedDate]; setMood(entry?.mood_value || null); setNote(entry?.note || ''); setReasons(entry ? reasonsMap[entry.id] || [] : []) }, [selectedDate, entries, reasonsMap])

  const calendarDays = useMemo(() => { const count = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate(); const blanks = (first.getDay() + 6) % 7; return [...Array.from({ length: blanks }, () => null), ...Array.from({ length: count }, (_, i) => i + 1)] }, [cursor.getFullYear(), cursor.getMonth()])

  async function save() {
    if (!mood) return
    const { data, error } = await supabase.from('mood_entries').upsert({ user_id: userId, entry_date: selectedDate, mood_value: mood, note: note || null }, { onConflict: 'user_id,entry_date' }).select('*').single()
    if (error) return setMessage(error.message)
    await supabase.from('mood_entry_reasons').delete().eq('mood_entry_id', data.id).eq('user_id', userId)
    if (reasons.length) { const options = reasonsForMood(mood); await supabase.from('mood_entry_reasons').insert(reasons.map((key) => ({ user_id: userId, mood_entry_id: data.id, reason_key: key, reason_label: options.find(([k]) => k === key)?.[1] || key }))) }
    setMessage('Сохранено. Завтра отмечать необязательно.')
    await loadMonth()
  }

  return <div className="page"><section className="page-heading compact-heading"><div><p className="eyebrow">НЕОБЯЗАТЕЛЬНО</p><h1>Настроение</h1><p className="muted">Отмечай только когда хочется оставить контекст. Пустой день ничего не портит.</p></div></section><section className="panel calendar-card"><div className="calendar-head"><button className="icon-button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><ChevronLeft size={19} /></button><strong>{new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(cursor)}</strong><button className="icon-button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}><ChevronRight size={19} /></button></div><div className="calendar-weekdays">{['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{calendarDays.map((day, index) => { if (!day) return <span className="calendar-empty" key={`e-${index}`} />; const key = localDateKey(new Date(cursor.getFullYear(), cursor.getMonth(), day)); const entry = entries[key]; return <button key={key} className={`calendar-day${selectedDate === key ? ' selected' : ''}`} onClick={() => setSelectedDate(key)}><span>{day}</span><strong>{entry ? MOODS.find((m) => m.value === entry.mood_value)?.emoji : '·'}</strong></button> })}</div></section><section className="panel mood-editor"><p className="eyebrow">{formatDateRu(selectedDate).toUpperCase()}</p><h2>Как было?</h2><div className="mood-row">{MOODS.map((item) => <button key={item.value} className={`mood-button${mood === item.value ? ' selected' : ''}`} onClick={() => { setMood(item.value); setReasons([]) }} title={item.label}>{item.emoji}</button>)}</div>{mood && <><div className="chip-wrap">{reasonsForMood(mood).map(([key, label]) => <button key={key} className={`chip${reasons.includes(key) ? ' selected' : ''}`} onClick={() => setReasons((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])}>{label}</button>)}</div><label><span>Заметка — необязательно</span><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></label><button className="primary-button" onClick={() => void save()}>Сохранить</button></>}{message && <p className="form-message success">{message}</p>}</section></div>
}

function TutorPage({ profile }: { profile: Profile }) {
  return <div className="page"><section className="page-heading compact-heading"><div><p className="eyebrow">ИИ-НАСТАВНИК</p><h1>Помощник, а не диспетчер</h1><p className="muted">ИИ будет объяснять ошибки и помогать с конкретной темой. Сейчас провайдерный слой подготовлен, но сама модель ещё не подключена.</p></div></section><section className="panel tutor-card"><Brain size={34} /><div><span className="status-badge">Провайдер: {profile.ai_provider}</span><h2>Пока не выдаём заглушку за готовый ИИ</h2><p>Учебная навигация, статистика, настроение и деньги уже работают без модели. Когда подключим GigaChat, этот экран станет полноценным наставником.</p></div></section></div>
}

function SettingsPage({ userId, profile, reloadProfile }: { userId: string; profile: Profile; reloadProfile: () => Promise<void> }) {
  const [name, setName] = useState(profile.display_name || '')
  const [provider, setProvider] = useState(profile.ai_provider)
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [message, setMessage] = useState('')
  useEffect(() => { void supabase.from('subjects').select('*').eq('user_id', userId).order('sort_order').then(({ data }) => setSubjects((data || []) as Subject[])) }, [userId])

  async function save() {
    const { error } = await supabase.from('profiles').update({ display_name: name, ai_provider: provider }).eq('id', profile.id)
    if (error) return setMessage(error.message)
    for (const subject of subjects) { const result = await supabase.from('subjects').update({ attention_weight: subject.attention_weight, recommended_gap_days: subject.recommended_gap_days }).eq('id', subject.id).eq('user_id', userId); if (result.error) return setMessage(result.error.message) }
    setMessage('Сохранено')
    await reloadProfile()
  }

  return <div className="page"><section className="page-heading compact-heading"><div><p className="eyebrow">НАСТРОЙКИ</p><h1>Michi под тебя</h1></div></section><section className="panel settings-card"><label><span>Имя или ник</span><input value={name} onChange={(e) => setName(e.target.value)} /></label><label><span>ИИ-провайдер</span><select value={provider} onChange={(e) => setProvider(e.target.value as Profile['ai_provider'])}><option value="gigachat">GigaChat</option><option value="openai">OpenAI — позже</option><option value="auto">Автоматически — позже</option></select></label></section><section className="panel settings-card"><div><p className="eyebrow">КАРТА ВНИМАНИЯ</p><h2>Насколько важны направления сейчас</h2><p className="muted tiny">Вес — не квота. Он лишь помогает раньше заметить, что один предмет вытеснил остальные.</p></div>{subjects.map((subject, index) => <div className="weight-row" key={subject.id}><div><strong>{subject.icon} {subject.name}</strong><span>Вес {subject.attention_weight} · заметить долгий перерыв после ~{subject.recommended_gap_days} дней</span></div><div><input type="range" min="1" max="5" value={subject.attention_weight} onChange={(e) => setSubjects((current) => current.map((item, i) => i === index ? { ...item, attention_weight: Number(e.target.value) } : item))} /><input className="gap-input" type="number" min="1" max="30" value={subject.recommended_gap_days} onChange={(e) => setSubjects((current) => current.map((item, i) => i === index ? { ...item, recommended_gap_days: Number(e.target.value) } : item))} /></div></div>)}</section><div className="action-row"><button className="primary-button" onClick={() => void save()}>Сохранить настройки</button><button className="secondary-button" onClick={() => { localStorage.removeItem(ACTIVE_STUDY_KEY); setMessage('Локальный таймер сброшен.') }}>Сбросить таймер</button></div>{message && <p className="form-message success">{message}</p>}<section className="panel logout-card"><div><strong>Выйти из аккаунта</strong><span className="muted tiny">Данные останутся в Supabase.</span></div><button className="secondary-button" onClick={() => void supabase.auth.signOut()}><LogOut size={17} /> Выйти</button></section></div>
}

function AuthenticatedApp({ session }: { session: Session }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState('')

  async function loadProfile() {
    setBusy(true)
    const { data, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
    if (error) { setMessage(error.message); setBusy(false); return }
    if (!data) { setBusy(false); return }
    try { await ensureWorkspace(session.user.id) } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось подготовить пространство') }
    setProfile(data as Profile)
    setBusy(false)
  }

  useEffect(() => { void loadProfile() }, [session.user.id])
  if (busy) return <LoadingScreen text="Готовим твой маршрут…" />
  if (!profile) return <div className="center-screen"><AlertCircle size={30} /><h2>Профиль ещё не появился</h2><p className="muted">{message || 'Попробуй выйти и войти снова.'}</p><button className="secondary-button" onClick={() => void supabase.auth.signOut()}>Выйти</button></div>
  if (!profile.onboarding_completed) return <OnboardingPage profile={profile} onDone={() => void loadProfile()} />
  return <AppShell userId={session.user.id} profile={profile} reloadProfile={loadProfile} />
}

function AppV2() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  useEffect(() => { void supabase.auth.getSession().then(({ data }) => setSession(data.session)); const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession)); return () => data.subscription.unsubscribe() }, [])
  if (session === undefined) return <LoadingScreen />
  if (!session) return <AuthPage />
  return <AuthenticatedApp session={session} />
}

export default function StableMichiApp() {
  return <ErrorBoundary><AppV2 /></ErrorBoundary>
}
